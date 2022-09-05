const {
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  Timestamp,
  where,
} = require("firebase/firestore");
const { db } = require("../utils/admin");
const { HUMAN_READABLE_DATE_FORMAT } = require("../utils/app-config");
const { isDealValid } = require("../utils/deals-utils");
const {
  RESERVATION_STATUS,
  RESERVATION_TOLERANCE_MINUTES,
  isReservationActive,
  isReservationValid,
} = require("../utils/reservations-utils");
const { CustomError } = require("../utils/CustomError");
const dayjs = require("dayjs");

// Methods
exports.redeemDeal = async (request, response) => {
  try {
    // Encontrar el deal con el ID proporcionado en el request.body
    const dealRef = doc(db, `Deals`, request.body.dealId);
    let deal = await getDoc(dealRef);
    if (!deal.exists()) {
      return response.status(400).json({
        message: "Deal does not exists.",
      });
    }

    // Validate that deal is linked to a restaurant
    if (!isDealValid(deal.data())) {
      return response.status(400).json({
        message: `This deal is not valid.`,
      });
    }

    // // Validate that deal is active
    if (!deal.get("active")) {
      // Validate deal does not exceed number of uses
      if (deal.get("useCount") >= deal.get("useMax")) {
        await updateDoc(deal.ref, { active: false });
        return response.status(400).json({
          message: `Sorry. This deal exceeds the ${deal.get(
            "useMax"
          )} maximum redemption limit.`,
        });
      }

      //
      return response.status(400).json({
        message: `Deal has been deactivated by restaurant or admin.`,
      });
    }

    // Validate that deal hasn't expired yet
    const NOW = Timestamp.now().toDate();
    const dealExpirationDate = deal.get("expiresAt").toDate();
    const dealExpirationWithTolerance = dayjs(dealExpirationDate).add(
      RESERVATION_TOLERANCE_MINUTES,
      "minute"
    );
    if (dayjs(NOW).isAfter(dealExpirationWithTolerance)) {
      return response.status(400).json({
        message: `Deal expired at ${dayjs(
          deal.get("expiresAt").toDate()
        ).format(HUMAN_READABLE_DATE_FORMAT)}.`,
      });
    }

    // Get reservations made by current user with a matching restaurant ID (Ex. Retrieved from scanning the QR)
    const reservationsQuery = query(
      collection(db, `Reservations`),
      where("customerId", "==", request.user.uid),
      where("dealId", "==", deal.id),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const reservations = await getDocs(reservationsQuery).catch((err) => {
      return response.status(500).json({
        message: err,
      });
    });

    // Verificar que la reservación exista.
    if (!reservations.size) {
      return response.status(400).json({
        message: "No reservations linked to this deal.",
      });
    }

    // Get reservation document
    let reservation = reservations.docs[0];

    // Verificar que la reservacion no haya sido concluída
    await isReservationActive(reservation.data()).catch((err) => {
      return response.status(400).json({
        message: "Reservation was already redeemed or was canceled.",
      });
    });

    // Verify if deal is active
    if (!reservation.get("active")) {
      return response.status(400).json({
        message: "The reservation is not active anymore.",
      });
    }

    // Verify that reservations is not expired
    const reservationExpiryDate = dayjs(
      reservation.get("reservationDate").toDate()
    );
    const reservationExpirationWithTolerance = dayjs(reservationExpiryDate).add(
      RESERVATION_TOLERANCE_MINUTES,
      "minute"
    );
    if (dayjs(NOW).isAfter(dayjs(reservationExpirationWithTolerance))) {
      return response.status(400).json({
        message: `Reservation expired at ${dayjs(reservationExpiryDate).format(
          HUMAN_READABLE_DATE_FORMAT
        )}.`,
      });
    }

    // Concluír la reservación (cambio de status)
    await updateDoc(reservation.ref, {
      status: RESERVATION_STATUS.COMPLETED,
      active: false,
      checkIn: Timestamp.fromDate(dayjs().toDate()),
    });
    reservation = await getDoc(reservation.ref);

    // Create redemption registry
    const redemptionCollection = collection(db, "DealRedemptions");
    await addDoc(redemptionCollection, {
      createdAt: Timestamp.fromDate(dayjs().toDate()),
      customerId: request.user.uid,
      dealId: deal.id,
    }).catch((err) => {
      return response.status(500).json({
        message: err,
      });
    });

    // Get total redemption count for this deal.
    const redemptionCount = await getDocs(
      query(redemptionCollection, where("dealId", "==", deal.id))
    );

    // Update deal use count
    await updateDoc(dealRef, { useCount: redemptionCount.size });
    deal = await getDoc(dealRef);

    // Re-validate maximum use count.
    if (deal.get("useCount") >= deal.get("useMax")) {
      await updateDoc(deal.ref, { active: false });
    }

    // Enviar notificación al restaurante.
    // (sms, email, push notification, ui)

    // Send confirmation to user
    return response.status(200).json({
      ...reservation.data(),
      id: reservation.id,
      createdAt: reservation.get("createdAt").toDate(),
      reservationDate: reservation.get("reservationDate").toDate(),
      cancelledAt: reservation.get("cancelledAt")?.toDate(),
      checkIn: reservation.get("checkIn")?.toDate(),
    });
  } catch (err) {
    return response.status(500).json({ message: err });
  }
};
exports.findDeal = async (request, response) => {
  //try {
  // Get reservations made by current user with a matching restaurant ID (Ex. Retrieved from scanning the QR)
  let reservations = await getUserReservationsByRestaurant(
    request.user.uid,
    request.params.restaurantId
  ).catch((err) => {
    return response.status(500).json({
      message: err,
    });
  });

  // Validate that there are any reservations
  if (!reservations.length) {
    return response.status(204).json({
      message: "No active reservations found.",
    });
  }

  // Get first reservation document
  let reservation = reservations[0];

  // Validate reservation status
  if (
    reservation.get("status") == RESERVATION_STATUS.RESERVATION_EXPIRED ||
    reservation.get("status") == RESERVATION_STATUS.COMPLETED ||
    reservation.get("status") == RESERVATION_STATUS.USER_CANCELED ||
    reservation.get("status") == RESERVATION_STATUS.RESTAURANT_CANCELED
  ) {
    return response.status(400).json({
      message: "Reservation was already redeemed or canceled.",
    });
  }

  // Validate that reservation is active (by admin or restaurant)
  if (reservation.get("active") != true) {
    return response.status(400).json({
      message: "Reservation has been deactivated by the admin.",
    });
  }

  // Validate reservation date hasnt expired.
  const NOW = Timestamp.now().toDate();
  const reservationExpiryDate = dayjs(
    reservation.get("reservationDate").toDate()
  );
  const reservationExpirationWithTolerance = dayjs(reservationExpiryDate).add(
    RESERVATION_TOLERANCE_MINUTES,
    "minute"
  );
  if (dayjs(NOW).isAfter(dayjs(reservationExpirationWithTolerance))) {
    return response.status(400).json({
      message: `Reservation expired at ${dayjs(reservationExpiryDate).format(
        HUMAN_READABLE_DATE_FORMAT
      )}.`,
    });
  }

  // Encontrar el deal vinculado a esa reservación
  const dealRef = doc(db, `Deals`, reservation.get("dealId"));
  let deal = await getDoc(dealRef);
  if (!deal.exists()) {
    return response.status(400).json({
      message: `Deal does not exists.`,
    });
  }

  // Validate that deal is linked to a restaurant
  if (!isDealValid(deal.data())) {
    return response.status(400).json({
      message: `The deal related to your reservation is not valid.`,
    });
  }

  // Validate that deal is active
  if (!deal.get("active")) {
    // Validate deal does not exceed number of uses
    if (deal.get("useCount") >= deal.get("useMax")) {
      await updateDoc(deal.ref, { active: false });
      return response.status(400).json({
        message: `This deal exceeds the ${deal.get(
          "useMax"
        )} maximum redemption limit.`,
      });
    }

    //
    return response.status(400).json({
      message: `Deal has been deactivated by restaurant or admin.`,
    });
  }

  // Validate that deal hasn't expired yet
  const dealExpirationDate = deal.get("expiresAt").toDate();
  const dealExpirationWithTolerance = dayjs(dealExpirationDate).add(
    RESERVATION_TOLERANCE_MINUTES,
    "minute"
  );
  if (dayjs(NOW).isAfter(dealExpirationWithTolerance)) {
    return response.status(400).json({
      message: `Deal expired at ${dayjs(dealExpirationDate).format(
        HUMAN_READABLE_DATE_FORMAT
      )}.`,
    });
  }

  // Enviar el más reciente deal encontrado
  return response.status(200).json({ ...deal.data(), id: deal.id });
};
exports.deleteAllDeals = async (request, response) => {
  try {
    // Get reservation
    const reservationRef = query(
      collection(`Deals`),
      where("restaurantId", "==", request.body.restaurantId)
    );
    const reservations = await getDocs(reservationRef);

    if (reservations.size) {
      for (const reservation of reservations.docs) {
        await deleteDoc(reservation.ref);
      }
    }

    // Send confirmation to user
    return response.status(200).json({});
  } catch (err) {
    return response.status(500).json({ message: err });
  }
};

const getUserReservationsByRestaurant = async (userId, restaurantId) => {
  const reservationsQuery = query(
    collection(db, "Reservations"),
    where("active", "==", true),
    where("customerId", "==", userId),
    where("restaurantId", "==", restaurantId),
    //where('reservationDate', '>=', Timestamp.fromDate(dayjs().toDate())),
    orderBy("reservationDate", "asc")
  );
  const reservations = await getDocs(reservationsQuery).catch((err) => {
    throw new Error(err);
  });
  return reservations.docs;
};
