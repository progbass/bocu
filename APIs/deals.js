const functions = require("firebase-functions");
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
const { db, adminDb, admin } = require("../utils/admin");
const { HUMAN_READABLE_DATE_FORMAT } = require("../utils/app-config");
const { isDealValid, doesDealHasRedemptionUsage } = require("../utils/deals-utils");
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
        message: "La oferta no existe.",
      });
    }

    // Validate that deal is linked to a restaurant
    if (!isDealValid(deal.data())) {
      return response.status(400).json({
        message: `La oferta no es válida.`,
      });
    }

    // // Validate that deal is active
    if (!deal.get("active")) {
      // TODO: Today the deal can 'active' = true||false.
      // It may be better to link this property to a 'status' catalog so we can have more granular monitor of the deal's state.
      // Eg. 'active', 'inactive', 'canceled', 'redemptionCountFull' or 'expired'.
      
      // If restaurants cancel a deal, user's reservations whould not be affected,
      // and deals must continue to be redeemable.
      // That's why, when a deal's status is set to inactive,
      // we are only checking if the deal redemption count is valid .

      // Validate deal does not exceed number of uses
      if (!doesDealHasRedemptionUsage(deal.data())) {
        await adminDb.doc(`Deals/${deal.id}`).update({active: false});
        return response.status(400).json({
          message: `La oferta excede el número de redenciones ${deal.get(
            "useMax"
          )}.`,
        });
      }

      // return response.status(400).json({
      //   message: `Deal has been deactivated by restaurant or admin.`,
      // });
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
        message: "No hay reservaciones vinculadas con esta oferta.",
      });
    }

    // Get reservation document
    let reservation = reservations.docs[0];

    // Verificar que la reservacion no haya sido concluída
    await isReservationActive(reservation.data()).catch((err) => {
      return response.status(400).json({
        message: "La reservación fue finalizada o cancelada.",
      });
    });

    // Verify if deal is active
    if (!reservation.get("active")) {
      return response.status(400).json({
        message: "Reservación no activa.",
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
        message: `La reservación expiró el ${dayjs(reservationExpiryDate).format(
          HUMAN_READABLE_DATE_FORMAT
        )}.`,
      });
    }

    // Concluír la reservación (cambio de status)
    await adminDb.doc(`Reservations/${reservation.id}`).update({
      status: RESERVATION_STATUS.COMPLETED,
      active: false,
      checkIn: dayjs().toDate(),
    }).catch((err) => {
      console.log('err')
      return response.status(500).json({
        message: err,
      });
    });
    reservation = await getDoc(reservation.ref);

    // Create redemption registry
    const redemptionCollection = collection(db, "DealRedemptions");
    await adminDb.collection("DealRedemptions").add({
      createdAt: dayjs().toDate(),
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
    await adminDb.doc(`Deals/${deal.id}`)
      .update({ useCount: redemptionCount.size })
      .catch((err) => {
        functions.logger.error(err);
        return response.status(500).json({
          message: err,
        });
      })
    deal = await getDoc(dealRef);

    // Re-validate maximum use count.
    if (!doesDealHasRedemptionUsage(deal.data())) {
      await adminDb.doc(`Deals/${deal.id}`)
        .update({active: false})
        .catch((err) => {
          functions.logger.error(err);
          return response.status(500).json({
            message: err,
          });
        });
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
      message: "No se encontraron reservaciones activas.",
    });
  }

  // Get first reservation document
  let dealFound;
  for(const reservation of reservations){

    // Validate reservation status
    if (
      reservation.get("status") == RESERVATION_STATUS.RESERVATION_EXPIRED ||
      reservation.get("status") == RESERVATION_STATUS.COMPLETED ||
      reservation.get("status") == RESERVATION_STATUS.USER_CANCELED ||
      reservation.get("status") == RESERVATION_STATUS.RESTAURANT_CANCELED
    ) {
      return response.status(400).json({
        message: "La reservación fue finalizada o cancelada.",
      });
    }

    // Validate that reservation is active (by admin or restaurant)
    if (reservation.get("active") != true) {
      return response.status(400).json({
        message: "Reservación no activa.",
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
        message: `La reservación expiró el ${dayjs(reservationExpiryDate).format(
          HUMAN_READABLE_DATE_FORMAT
        )}.`,
      });
    }

    // Encontrar el deal vinculado a esa reservación
    const dealRef = doc(db, `Deals`, reservation.get("dealId"));
    let deal = await getDoc(dealRef);
    if (!deal.exists()) {
      continue
      // return response.status(400).json({
      //   message: `Deal does not exists.`,
      // });
    }

    // Validate that deal is linked to a restaurant
    if (!isDealValid(deal.data())) {
      return response.status(400).json({
        message: `La oferta vinculada con tu reservación no es válida.`,
      });
    }

    // Validate that deal is active
    if (!deal.get("active")) {
      // Validate deal does not exceed number of uses
      if (!doesDealHasRedemptionUsage(deal.data())){
        await adminDb.doc(`Deals/${deal.id}`).update({active: false});
        return response.status(400).json({
          message: `La oferta excede el número de redenciones ${deal.get(
            "useMax"
          )}.`,
        });
      }

      //
      // return response.status(400).json({
      //   message: `Deal has been deactivated by restaurant or admin.`,
      // });
    }

    // Validate that deal hasn't expired yet
    const dealExpirationDate = deal.get("expiresAt").toDate();
    const dealExpirationWithTolerance = dayjs(dealExpirationDate).add(
      RESERVATION_TOLERANCE_MINUTES,
      "minute"
    );
    if (dayjs(NOW).isAfter(dealExpirationWithTolerance)) {
      return response.status(400).json({
        message: `La oferta expiró el ${dayjs(dealExpirationDate).format(
          HUMAN_READABLE_DATE_FORMAT
        )}.`,
      });
    }
    
    //
    dealFound = deal;
    break;
  }

  if(!dealFound){
    return response.status(400).json({
        message: `La oferta no existe.`,
      });
  }

  // Enviar el más reciente deal encontrado
  return response.status(200).json({ 
    ...dealFound.data(), 
    id: dealFound.id,
    createdAt: dealFound.get("createdAt").toDate(),
    expiresAt: dealFound.get("expiresAt").toDate(),
    startsAt: dealFound.get("startsAt").toDate(),
  });
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
