const {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile
} = require("firebase/auth");
const { auth, db, adminAuth } = require("../utils/admin");
const {
  doc,
  addDoc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  orderBy,
  where,
  query,
  limit,
  Timestamp,
} = require("firebase/firestore");
const dayjs = require("dayjs");
const { getReservationStatusDetails, RESERVATION_STATUS } = require("../utils/reservations-utils");
const { USER_ROLES, LISTING_CONFIG } = require("../utils/app-config");
const { signIn } = require("./auth");
const { getUserData } = require("../utils/auth")

function handleError(res, err) {
  return res.status(500).send({ message: `${err.code} - ${err.message}` });
}

exports.createUser = async (req, res) => {
  try {
    const { password, email, role = USER_ROLES.CUSTOMER } = req.body;

    if (!password || !email || !role) {
      return res.status(400).send({ message: "Missing fields" });
    }

    // Create user in Firebase Auth
    const user = await adminAuth.createUser({
      password,
      email,
    });
    await adminAuth.setCustomUserClaims(user.uid, { role });

    // Create user in the database
    await setDoc(doc(db, "Users", user.uid), {
      authId: user.uid,
      email: user.email,
      firstName: user.displayName ? user.displayName : '',
      lastName: user.lastName ? user.lastName : '',
      role: user.customClaims ? user.customClaims.role : USER_ROLES.CUSTOMER,
      createdAt: dayjs().toDate(),
      updatedAt: dayjs().toDate()
    });

    if(req.query.userRef == USER_ROLES.ADMIN || req.query.userRef == USER_ROLES.SUPER_ADMIN) {
      return res.json({ message: "Usuario creado exitosamente." });
    }

    // Log user in
    const data = await signIn(user.uid);

    // Send verification email
    await sendEmailVerification(auth.currentUser);

    // Sign out user
    //await signOut(auth);

    //
    return res.json(data);
  } catch (err) {
    return handleError(res, err);
  }
};
exports.getCurrentUser = async (request, response) => {
  if (request.user) {
    //
    const {
      stsTokenManager,
      auth: authObj,
      reloadListener,
      reloadUserInfo,
      proactiveRefresh,
      ...userData
    } = request.user;
    return response.json({
      ...userData,
      //accessToken: customUserToken,
      //token: customUserToken
    });
  }
  //
  return response
    .status(409)
    .json({ message: "User not logged in.", type: "error" });
};
exports.getUser = async (request, response) => {
  const user = await adminAuth.getUser(request.params.userId).catch((err) => {
    return response.status(404).json({ ...err, message: "No se encontró el usuario." });
  });
  //
  if (user) {
    // Get all user's data
    const userData = await getUserData(user.uid);

    //
    return response.json({
      ...user,
      ...userData
    });
  }
  //
  return response.status(404).json({ message: "No se encontró el usuario." });
};
exports.editUser = async (request, response) => {
  // Update user profile
  await updateProfile(auth.currentUser, {
    ...request.body
  }).catch((err) => {
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al actualizar el usuario.',
    });
  });

  // Get user's complementary data
  const userData = await getUserData(auth.currentUser.uid);

  // Return user profile
  return response.json({
    ...auth.currentUser.toJSON(),
    ...userData
  });
};
exports.getUsers = async (request, response) => {
  const usersLimit = parseInt(request.query.limit) || LISTING_CONFIG.MAX_LIMIT;
  let usersList = await getDocs(
    query(
      collection(db, "Users"),
      limit(usersLimit),
      orderBy("createdAt", "desc")
    )
  ).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al obtener los usuarios.',
    });
  });

  if (usersList.docs) {
    let userFound;
    const users = [];
    for (const user of usersList.docs) {
      let fullProfile = {
        ...user.data(),
        id: user.id,
      };

      // Seach in Firebase Auth for the current DB user
      userFound = true;
      const userAuth = await adminAuth
        .getUser(user.get("authId"))
        .catch((err) => {
          userFound = false;
        });
      // If user exists in Firebase Auth, add details to the list
      if (userFound && userAuth) {
        users.push({
          ...fullProfile,
          ...userAuth.toJSON(),
          role: userAuth.customClaims?.role,
        });
        continue;
      }

      // Include the user in the return list
      users.push(fullProfile);
    }

    return response.json(users);
  } else {
    return response.status(204).json([]);
  }
};
exports.deleteUser = async (request, response) => {
  // Get user authId
  const userDoc = doc(db, "Users", request.params.userId);
  const user = await getDoc(userDoc);

  // Remove user from firestore
  await deleteDoc(userDoc).catch((err) => {
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al eliminar el usuario.',
    });
  });

  // Remove from Firebase Authentication module
  const firebaseAuthUser = await adminAuth
    .getUser(user.get("authId"))
    .catch((err) => {});
  if (firebaseAuthUser) {
    await adminAuth.deleteUser(user.get("authId"));
  }
  console.error(firebaseAuthUser);

  return response.status(200).json({ message: "Success" });
};

exports.getUserDeals = (request, response) => {
  getDocs(
    query(
      collection(db, "UserDeals"),
      where("userId", "==", request.params.userId),
      limit(LISTING_CONFIG.MAX_LIMIT)
    )
  )
    .then((data) => {
      let todos = [];
      data.forEach((doc) => {
        todos.push({
          id: doc.id,
          limit: doc.data().limit,
          dealId: doc.data().dealId,
          redeemed: doc.data().redeemed,
          userId: doc.data().restaurantId,
          createdAt: doc.data().createdAt,
        });
      });
      return response.json(todos);
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({ ...err, message: 'Ocurrió un error al obtener las ofertas.' });
    });
};
// 
exports.getUserReservations = async (request, response) => {
  const filtersList = [
    where("customerId", "==", request.user.uid)
  ];

  // Filter by 'active' state (true by default)
  if(request.query.active && request.query.active != ''){
    let filterByActive = request.query?.active && request.query?.active == 'false' ? false : true;
    filtersList.push(where("active", "==", filterByActive));
  }

  // Filter by date range
  let range_init = request.query.range_init;
  if (range_init && range_init != '') {
    if(dayjs(request.query.range_init).isValid()){
    range_init = dayjs(dayjs(request.query.range_init).toISOString())
      //.utcOffset(UTC_OFFSET, true)
      .toDate()

      filtersList.push(where(
        "reservationDate",
        ">=",
        Timestamp.fromDate(range_init)
      ))
    }
  }
  let range_end = request.query.range_end;
  if (range_end && range_end != '') {
    if(dayjs(request.query.range_end).isValid()){
      range_end = dayjs(request.query.range_end)
        .hour(23)
        .minute(59)
        .second(59)
        //.utcOffset(UTC_OFFSET, true)
        .toDate()
    
      filtersList.push(where(
        "reservationDate", 
        "<=", 
        Timestamp.fromDate(range_end)
      ))
    }
  }

  // Filtery by status
  let statusCode = undefined;
  let status = request.query?.status || undefined;
  if (status) {
    switch (status) {
      case "canceled":
        statusCode = RESERVATION_STATUS.USER_CANCELED;
        break;
      case "tolerance":
        statusCode = RESERVATION_STATUS.TOLERANCE_TIME;
        break;
      case "expired":
        statusCode = RESERVATION_STATUS.RESERVATION_EXPIRED;
        break;
      case "fulfilled":
        statusCode = RESERVATION_STATUS.COMPLETED;
        break;
      case "restaurant-canceled":
        statusCode = RESERVATION_STATUS.RESTAURANT_CANCELED;
        break;
      case "other":
        statusCode = RESERVATION_STATUS.OTHER;
        break;
      
      default:
      case "awaiting":
        statusCode = RESERVATION_STATUS.AWAITING_CUSTOMER;
        break;
    }
    filtersList.push(where("status", "==", statusCode));
  }

  // Get Reservations results
  let reservationsQuery = query(
    collection(db, `Reservations`),
    ...filtersList,
    orderBy('reservationDate', 'desc')
  );
  const reservations = await getDocs(reservationsQuery).catch((err) => {
    console.log(err)
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al obtener las reservaciones.',
    });
  });
  
  // Parse reservations list if any
    let reservationsResults = [];
    for (let document of reservations.docs) {
      const reservation = document.data();

      // Get restaurant data
      const restaurant = await getDoc(doc(db, `Restaurants/${reservation.restaurantId}`)).catch((err) => {});
      if(!restaurant.exists()){
        continue
      }
      
      // Get Deal related to the reservation
      const dealReference = doc(db, 'Deals', reservation.dealId);
      const deal = await getDoc(dealReference).catch((err) => {
        return response.status(500).json({
          ...err,
          message: 'Ocurrió un error al obtener la oferta vinculada con esta reservación.',
        });
      });

      // Dont include reservation in the list if linked deal is not found
      if(!deal.exists()){
        continue;
      }

      // Preformat a human-readable 'status' description
      let dealDetails;
      switch (deal.data().dealType) {
        case 2:
          dealDetails = deal.data().details ? `${deal.data()?.details}.` : '';
          break;
        case 1:
        default:
          dealDetails = `${deal.data().discount * 100}% de descuento.`;
      }

      // Get Customer from Firestore
      let customer = await getDoc(doc(db, 'Users', reservation.customerId))
        .catch((err) => {});
      let customerEmail = 'Usuario no encontrado';
      if(customer.exists()){
        customerEmail = customer.data().email;
      } else {
        // If user was not found, try to get it from Firebase Auth
        customer = await adminAuth.getUser(reservation.customerId).catch((err) => {});
        if(customer){
          customerEmail = customer.email; 
        }
      }

      // Determine status description
      let statusDescription = getReservationStatusDetails(reservation.status);

      // Format deal data
      reservationsResults.push({
        id: document.id,
        ...reservation,
        statusDescription,
        checkIn: reservation.checkIn ? dayjs(reservation.checkIn).toDate() : null,
        createdAt: reservation.createdAt.toDate(),
        reservationDate: reservation.reservationDate.toDate(),
        restaurantName: restaurant.data(),
        dealType: deal.data().dealType,
        dealDetails,
        dealTerms: deal.data().terms ? deal.data().terms : '',
        customer: customerEmail,
      });
    }
    return response.json(reservationsResults);
};

// Verify username availability
exports.isUsernameAvailable = async (request, response) => {
  // TODO: Validate for case sensitive.
  let document = await getDocs(
    query(
      collection(db, "Users"),
      where("email", "==", `${request.params.email}`)
    )
  )
    .then((data) => {
      if (data.size) {
        return response.json({
          available: false,
        });
      } else {
        return response.json({
          available: true,
        });
      }
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: 'Ocurrió un error al verificar la disponibilidad del nombre de usuario.',
      });
    });
};

//
exports.claimDeal = (request, response) => {
  // TODO: Validar que el requester no haya realizado un claim anteriormente

  // TODO: Verify number of redemptions

  // Add claim registry
  const newClaim = {};
  addDoc(collection(db, "UserDeals"), newClaim)
    .then((data) => {
      return response.json(newClaim);
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({ ...err, message: 'Ocurrió un error al reclamar la oferta.' });
    });
};
exports.redeemDeal = (request, response) => {
  // TODO: Validar que el usuario sea el requester

  // TODO: Verify number of redemptions

  // Redeem claim
  const newClaim = {
    ...request.body,
    redeemed: true,
  };
  updateDoc(doc(db, `/UserDeals/`, request.params.dealId), newClaim)
    .then((data) => {
      return response.json(newClaim);
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({ ...err, message: 'Ocurrió un error al redimir la oferta.' });
    });
};

//


