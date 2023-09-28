const { stringify } = require("csv-stringify");
const {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} = require("firebase/auth");
const { auth, db, adminDb, adminAuth, admin } = require("../utils/admin");
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
  startAfter,
  startAt
} = require("firebase/firestore");
const functions = require("firebase-functions");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { getNewBillingObject } = require("../utils/billing-utils");
const { USER_ROLES, DEFAULT_TAKE_RATE, LISTING_CONFIG, SEARCH_CONFIG } = require("../utils/app-config");
const { DEAL_TYPE } = require("../utils/deals-utils");
const getCurrentUser = require("../utils/getCurrentUser");
const algoliasearch = require("algoliasearch");
const { getFormattedDeal, getFormattedReservation } = require("./partners");
const { RESERVATION_STATUS } = require("../utils/reservations-utils");

// Config Algolia SDK
const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_ADMIN_API_KEY
);

function handleError(res, err) {
  return res.status(500).send({ message: `${err.code} - ${err.message}` });
}

// Users CRUD
exports.setUserRole = async (req, res) => {
  try {
    const { uid, role } = req.body;

    // Validate fields
    if (!uid) {
      return res.status(400).send({ message: "Missing user ID." });
    }
    if (!role || !Object.values(USER_ROLES).includes(role)) {
      return res.status(400).send({ message: "User role not defined." });
    }

    // Define user role in firebase Auth
    await adminAuth.setCustomUserClaims(uid, { role });

    // Resturn modified user
    const userAuth = await adminAuth.getUser(uid);
    return res.json({
      ...userAuth.toJSON(),
    });
  } catch (err) {
    return handleError(res, err);
  }
};
exports.editUser = async (request, response) => {
  const user = await adminAuth
    .updateUser(request.params.userId, {
      ...request.body,
    })
    .catch((err) => {
      return response.status(404).json({ message: "Usuario no encontrado." });
    });

  //
  if (user) {
    // Get Users firestore node
    const userDoc = await getDoc(doc(db, "Users", user.uid));
    const userNode = userDoc.data() ? userDoc.data() : {};

    //
    return response.json({ ...user.toJSON(), ...userNode });
  }
  //
  return response.status(404).json({ message: "Usuario no encontrado." });
};
exports.deleteUser = async (request, response) => {
  // Get user authId
  const userDoc = doc(db, "Users", request.params.userId);
  const user = await getDoc(userDoc);

  // Remove user from firestore
  await deleteDoc(userDoc).catch((err) => {
    return response.status(500).json({
      ...err,
      message: 'Error al eliminar el usuario.',
    });
  });

  // Remove from Firebase Authentication module
  let authError = "";

  try {
    await adminAuth.deleteUser(user.get("authId"));
  } catch (err) {
    console.error(err);
    authError = err;
    // return response.status(500).json({
    //     error: err.code
    // });
  }

  return response.status(200).json({ message: "Success", error: authError });
};
exports.getAdminUsersSummary = async (request, response) => {
  // Get all users
  const allUsersDocs = await getDocs(
    query(
      collection(db, "Users")
    )
  );
  const allUsers = allUsersDocs.docs || [];

  // Set defautl counter values
  let totalUsersCount = allUsers.length;
  let verifiedUsersCount = 0;
  let createdThisMonth = 0;
  let createdToday = 0;
  let withReservations = 0;

  for(let user of allUsers){
    // Is verified?
    if(user.data().emailVerified){
      verifiedUsersCount += 1;
    }
    // Is created this month?
    if(dayjs(user.data().createdAt.toDate()).isValid()
      && dayjs(user.data().createdAt.toDate()).isSame(dayjs().startOf('month'), 'month')
    ){
      createdThisMonth += 1;
    }
    // Is created today?
    if(dayjs(user.data().createdAt.toDate()).isValid()
      && dayjs(user.data().createdAt.toDate()).isSame(dayjs().startOf('day'), 'day')
    ){
      createdToday += 1;
    }
  }

  // Return counters
  return response.json({
    total: totalUsersCount,
    verified: verifiedUsersCount,
    thisMonth: createdThisMonth,
    today: createdToday,
  });
};

// Restaurants CRUD
const getRestaurantsList = async (config = {}) => {
  const algoliaIndex = algoliaClient.initIndex('Restaurants');
  
  // Search configuration
  const {
    size: userParamSize,
    aroundRadius: userParamRadius,
    p: userParamPage,
    filters: filters = '',
    query: searchQuery = '',
    ...userParams
  } = config;
  
  // Validate filters
  let hitsPerPage = SEARCH_CONFIG.MAX_SEARCH_RESULTS_HITS;
  if (userParamSize && parseInt(userParamSize)) {
    hitsPerPage = userParamSize;
  }
  let aroundRadius = SEARCH_CONFIG.DEFAULT_AROUND_RADIUS;
  if (userParamRadius && parseInt(userParamRadius)) {
    aroundRadius = userParamRadius;
  }
  let page = SEARCH_CONFIG.DEFAULT_PAGE;
  if (userParamPage && parseInt(userParamPage)) {
    page = userParamPage;
  }

  // Get restaurants
  const searchResults = await algoliaIndex
  .search(searchQuery, {
    //...userParams,
    filters,
    page,
    aroundRadius,
    hitsPerPage,
  }).catch((err) => {
    throw err;
  });

  // Format restaurant docs
  let docs = searchResults.hits;
  let restaurants = [];
  for (let doc of docs) {
    // Exlude restaurants without ID (invalid)
    const restaurantId = doc.id || doc.objectID || undefined;
    if(!restaurantId ){
      continue
    }

    // Get restaurant ratings
    const raitingRef = await getDocs(
      query(
        collection(db, `RestaurantRatings`),
        where("restaurantId", "==", restaurantId)
      )
    ).catch((err) => {
      console.error(err);
      return;
    });

    // Get raitings average
    let rating = 0;
    const ratingCount = raitingRef.size;
    if (ratingCount) {
      let counterGroups = {
        one: 0,
        two: 0,
        three: 0,
        four: 0,
        five: 0,
      };
      raitingRef.forEach((doc) => {
        switch (doc.data().rate) {
          case 1:
            counterGroups.one += 1;
            break;
          case 2:
            counterGroups.two += 1;
            break;
          case 3:
            counterGroups.three += 1;
            break;
          case 4:
            counterGroups.four += 1;
            break;
          case 5:
            counterGroups.five += 1;
            break;
        }
      });
      rating =
        (1 * counterGroups.one +
          2 * counterGroups.two +
          3 * counterGroups.three +
          4 * counterGroups.four +
          5 * counterGroups.five) /
        (5 * ratingCount);
      rating *= 5;
      rating = `${rating} (${ratingCount})`;
    }


    // Return restaurant object
    restaurants.push({
      ...doc,
      id: doc.objectID,
      rating,
      createdAt: dayjs(doc.createdAt).toDate(),
      updatedAt: dayjs(doc.updatedAt).toDate(),
    });
  }

  // Return restaurants
  return {
    ...searchResults,
    hits: restaurants,
  };
}
exports.getAdminRestaurants = async (request, response) => {
  const searchResults = await getRestaurantsList(
    request.body
  ).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Error al obtener los restaurantes.',
    });
  });
  

  // Early return if there are no results
  if(!searchResults.hits.length) {
    return response.status(200).json([]);
  }

  // Format restaurant docs
  let docs = searchResults.hits;
  let restaurants = [];
  for (let doc of docs) {
    // Get restaurant ratings
    const raitingRef = await getDocs(
      query(
        collection(db, `RestaurantRatings`),
        where("restaurantId", "==", doc.id)
      )
    ).catch((err) => {
      console.error(err);
      return;
    });

    // Get raitings average
    let rating = 0;
    const ratingCount = raitingRef.size;
    if (ratingCount) {
      let counterGroups = {
        one: 0,
        two: 0,
        three: 0,
        four: 0,
        five: 0,
      };
      raitingRef.forEach((doc) => {
        switch (doc.data().rate) {
          case 1:
            counterGroups.one += 1;
            break;
          case 2:
            counterGroups.two += 1;
            break;
          case 3:
            counterGroups.three += 1;
            break;
          case 4:
            counterGroups.four += 1;
            break;
          case 5:
            counterGroups.five += 1;
            break;
        }
      });
      rating =
        (1 * counterGroups.one +
          2 * counterGroups.two +
          3 * counterGroups.three +
          4 * counterGroups.four +
          5 * counterGroups.five) /
        (5 * ratingCount);
      rating *= 5;
      rating = `${rating} (${ratingCount})`;
    }

    // Return restaurant object
    restaurants.push({
      ...doc,
      rating,
    });
  }

  //
  return response.json(restaurants);
};
exports.getAdminRestaurantsSummary = async (request, response) => {
  // Get all restaurants
  const allRestaurantsDocs = await getDocs(
    query(
      collection(db, "Restaurants")
    )
  );

  // Default counters
  const allRestaurants = allRestaurantsDocs.docs || [];
  let createdRestaurantsToday = 0;
  let createdRestaurantsMonth = 0;
  let totalRestaurants = allRestaurants.length;
  let publishedRestaurants = 0;
  let activeRestaurantsToday = 0;
  let approvedRestaurants = 0;

  //
  for(let restaurant of allRestaurants){
    // Is created today?
    if(dayjs(restaurant.data()?.createdAt).isValid()
      && dayjs(restaurant.data()?.createdAt).isSame(dayjs().startOf('day'), 'day')
    ){
      createdRestaurantsToday += 1;
    }
    // Is created this month?
    if(dayjs(restaurant.data()?.createdAt).isValid()
      && dayjs(restaurant.data()?.createdAt).isSame(dayjs().startOf('month'), 'month')
    ){
      createdRestaurantsMonth += 1;
    }
    // Is active?
    if(restaurant.data().active){
      activeRestaurantsToday += 1;
    }
    // Is approved
    if(restaurant.data().isApproved){
      approvedRestaurants += 1;
    }
    // Is published?
    if(restaurant.data().active && restaurant.data().isApproved){
      publishedRestaurants += 1;
    }
  }

  // Return counters
  return response.status(200).json({
    today: createdRestaurantsToday,
    thisMonth: createdRestaurantsMonth,
    total: totalRestaurants,
    published: publishedRestaurants,
    active: activeRestaurantsToday,
    approved: approvedRestaurants
  });
};

// Deals CRUD
const getDealsList = async (queryParams = {}) => {
  let periodStart = dayjs().startOf("day").toDate();
  let periodEnd = dayjs().endOf("day").toDate();
  let restaurantActive = true;
  let restaurantApproved = true;
  const filtersList = [
    where("active", "==", true)
  ];

  // Validations
  if(queryParams.query) {
    // Get restaurants (from Algolia)
    const searchResults = await getRestaurantsList(
      {
        query: queryParams.query
      }
    ).catch((err) => {
      console.error(err);
      throw new Error("Error al obtener los restaurantes.");
    });
    const restaurantIds = searchResults.hits.map((restaurant) => restaurant.id);

    // Early return if there are no results
    if(!restaurantIds.length) {
      return [];
    }

    // Add restaurant filter
    filtersList.push(where("restaurantId", "in", restaurantIds));
  }
  if(queryParams.periodStart && dayjs(queryParams.periodStart).isValid()) {
    periodStart = dayjs(queryParams.periodStart).startOf("day").toDate();
    filtersList.push(where("startsAt", ">=", periodStart))
  }
  if(queryParams.periodEnd && dayjs(queryParams.periodEnd).isValid()) {
    periodEnd = dayjs(queryParams.periodEnd).endOf("day").toDate();
    filtersList.push(where("startsAt", "<=", periodEnd))
  }

  const activeDeals = await getDocs(
    query(
      collection(db, `Deals`),
      ...filtersList,
      orderBy("startsAt", "asc"),
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las ofertas.");
  });

  const formattedDeals = [];
  if(activeDeals.size) {
    for(let deal of activeDeals.docs) {
      let restaurantNotFound = false;
      if(!deal.data().restaurantId){
        continue
      }
      const restaurant = await getDoc(
        doc(db, `Restaurants`, deal.data().restaurantId)
      ).catch((err) => {
        console.error(err);
        restaurantNotFound = true;
      });
      if(restaurantNotFound || !restaurant.exists()){
        continue;
      }

      console.log('---------------')
      console.log('name ', restaurant.data().name)
      console.log('isApproved ', restaurant.data().isApproved)
      console.log('active ', restaurant.data().active)

      // Post validations
      if(queryParams.restaurantActive){
        restaurantActive = queryParams.restaurantActive == 'false' ? false : true;
        console.log('restaurantActive ', restaurantActive);
        if(restaurant.data().active != restaurantActive){
          continue;
        }
      }
      if(queryParams.restaurantApproved){
        restaurantApproved = queryParams.restaurantApproved == 'false' ? false : true;
        console.log('restaurantApproved ', restaurantApproved);
        if(restaurant.data().isApproved != restaurantApproved){
          continue;
        }
      }

      //
      formattedDeals.push( (await getFormattedDeal(deal)) );
    }
  }

  return formattedDeals;
}
exports.getAdminDeals = async (request, response) => {
  const dealsList = await getDealsList({...request.query})
    .catch((err) => {
      //console.log(err)
      return response.status(500).json({ message: err.message });
    });

  return response.status(200).json(dealsList);
};
exports.getAdminDealsSummary = async (request, response) => {
  const dealsCollection = collection(db, `Deals`);
  const activeDealsToday = await getDocs(
    query(
      dealsCollection,
      where("active", "==", true),
      where("startsAt", ">=", dayjs().startOf("day").toDate()),
      where("startsAt", "<=", dayjs().endOf("day").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las ofertas.");
  });
  const activeDealsMonth = await getDocs(
    query(
      dealsCollection,
      where("active", "==", true),
      where("startsAt", ">=", dayjs().startOf("month").toDate()),
      where("startsAt", "<=", dayjs().endOf("month").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las ofertas.");
  });
  const createdDealsMonth = await getDocs(
    query(
      dealsCollection,
      where("startsAt", ">=", dayjs().startOf("month").toDate()),
      where("startsAt", "<=", dayjs().endOf("month").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las ofertas.");
  });

  // Return counters
  return response.status(200).json({
    activeDealsToday: activeDealsToday.size,
    activeDealsMonth: activeDealsMonth.size,
    createdDealsMonth: createdDealsMonth.size
  });
};

// Reservations CRUD
const getReservationsList = async (queryParams = {}) => {
  let periodStart = dayjs().startOf("day").toDate();
  let periodEnd = dayjs().endOf("day").toDate();
  let active = queryParams.active && queryParams.active == 'false' ? false : true;
  let lastReservation = null;
  const filtersList = [
    where("active", "==", active)
  ];

  // Validations
  if(queryParams.query) {
    // Get restaurants (from Algolia)
    const searchResults = await getRestaurantsList(
      {
        query: queryParams.query
      }
    ).catch((err) => {
      console.error(err);
      throw new Error("Error al obtener los restaurantes.");
    });
    const restaurantIds = searchResults.hits.map((restaurant) => restaurant.id);

    // Early return if there are no results
    if(!restaurantIds.length) {
      return [];
    }

    // Add restaurant filter
    filtersList.push(where("restaurantId", "in", restaurantIds));
  }
  if(queryParams.periodStart && dayjs(queryParams.periodStart).isValid()) {
    periodStart = dayjs(queryParams.periodStart).startOf("day").toDate();
    filtersList.push(where("reservationDate", ">=", periodStart))
  }
  if(queryParams.periodEnd && dayjs(queryParams.periodEnd).isValid()) {
    periodEnd = dayjs(queryParams.periodEnd).endOf("day").toDate();
    filtersList.push(where("reservationDate", "<=", periodEnd))
  }
  if(queryParams.status && Number(queryParams.status) >= 0) {
    console.log('status ', Number(queryParams.status))
    filtersList.push(where("status", "==", Number(queryParams.status)));
  }
  if(queryParams.lastId){
    const lastReservationId = queryParams.lastId;
    console.log(lastReservationId)
    const lastReservationDocument = await getDoc(
      doc(db, `Reservations`, lastReservationId)
    ).catch((err) => {
      console.error(err);
      throw new Error("Error al obtener las reservaciones.");
    });
    if(lastReservationDocument.exists()){
      lastReservation = lastReservationDocument;
    }
  }

  const reservations = await getDocs(
    query(
      collection(db, `Reservations`),
      ...filtersList,
      limit(Number(queryParams.limit) > 0 ? Number(queryParams.limit) : LISTING_CONFIG.MAX_LIMIT),
      orderBy("reservationDate", "asc"),
      startAfter(lastReservation)
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las reservaciones.");
  });

  const formattedResults = [];
  if(reservations.size) {
    for(let reservation of reservations.docs) {
      formattedResults.push( await getFormattedReservation(reservation) )
    }
  }

  return formattedResults;
}
exports.getAdminReservations = async (request, response) => {
  const reservationsList = await getReservationsList(
    {
      ...request.query,
    }
  ).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: err.message });
  });

  //
  return response.status(200).json(reservationsList);
};
exports.getAdminReservationsSummary = async (request, response) => {
  const reservationsCollection = collection(db, `Reservations`);
  const activeReservationsToday = await getDocs(
    query(
      reservationsCollection,
      where("active", "==", true),
      where("reservationDate", ">=", dayjs().startOf("day").toDate()),
      where("reservationDate", "<=", dayjs().endOf("day").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las reservaciones.");
  });
  const activeReservationsMonth = await getDocs(
    query(
      reservationsCollection,
      where("active", "==", true),
      where("reservationDate", ">=", dayjs().startOf("month").toDate()),
      where("reservationDate", "<=", dayjs().endOf("month").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las reservaciones.");
  });
  const completedReservationsMonth = await getDocs(
    query(
      reservationsCollection,
      where("status", "==", RESERVATION_STATUS.COMPLETED),
      where("active", "==", false),
      where("reservationDate", ">=", dayjs().startOf("month").toDate()),
      where("reservationDate", "<=", dayjs().endOf("month").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las reservaciones.");
  });
  const createdReservationsMonth = await getDocs(
    query(
      reservationsCollection,
      where("reservationDate", ">=", dayjs().startOf("month").toDate()),
      where("reservationDate", "<=", dayjs().endOf("month").toDate())
    )
  ).catch((err) => {
    console.error(err);
    throw new Error("Error al obtener las reservaciones.");
  });

  // Return counters
  return response.status(200).json({
    activeReservationsToday: activeReservationsToday.size,
    activeReservationsMonth: activeReservationsMonth.size,
    completedReservationsMonth: completedReservationsMonth.size,
    createdReservationsMonth: createdReservationsMonth.size
  });
};

// Billing CRUD
const createRestaurantBilling = async (restaurantId, periodStart, periodEnd, manualAdjustment = 0) => {
  // Get restaurant
  const restaurant = await adminDb.doc(`Restaurants/${restaurantId}`).get()
    .catch((err) => {
      throw new Error("Restaurante no encontrado.");
    });
  // const restaurant = await getDoc(
  //   doc(db, "Restaurants", restaurantId)
  // ).catch((err) => {
  //   throw new Error("Restaurante no encontrado.");
  // });

  // Get Deals whithin period
  const dealsQuery = adminDb.collection('Deals')
    .where("restaurantId", "==", restaurantId)
    .where("createdAt", ">=", periodStart)
    .where("createdAt", "<=", periodEnd)
    .orderBy("createdAt", "desc");
  const deals = await dealsQuery.get().catch((err) => {
    throw new Error("Error al obtener las ofertas.");
  });
  // const deals = await getDocs(dealsQuery).catch((err) => {
  //   throw new Error("Error al obtener las ofertas.");
  // });

  // Get Redemptions
  const redemptionsQuery = adminDb.collection("DealRedemptions")
    .where("restaurantId", "==", restaurantId)
    .where("createdAt", ">=", periodStart)
    .where("createdAt", "<=", periodEnd)
    .orderBy("createdAt", "desc");
  const redemptions = await redemptionsQuery.get().catch((err) => {
    throw new Error("Error al obtener las redenciones.");
  });

  // Calculate balance
  let calculatedBalance = 0;
  redemptions.docs.forEach((redemption) => {
    const averageTicket = redemption.get("averageTicket") ? parseFloat(redemption.get("averageTicket")) : 0;
    const takeRate = redemption.get("takeRate") ? parseFloat(redemption.get("takeRate")) : DEFAULT_TAKE_RATE;
    calculatedBalance += averageTicket * takeRate;
  });

  // Calculate total balance
  const totalBalance = calculatedBalance + manualAdjustment;
  const paidQuantity = 0

  // Billing object model
  const billing = getNewBillingObject(
    restaurant.id,
    dayjs(periodStart).toDate(),
    dayjs(periodEnd).toDate(),
    {
      redemptions: redemptions.docs.map((deal) => deal.id),
      totalDeals: deals.docs.length, 
      calculatedBalance,
      manualAdjustment,
      totalBalance,
      paidQuantity: 0,
      debtQuantity: totalBalance - paidQuantity,
    }
  );

  // Create billing
  const billingDoc = await adminDb.collection("Billings").add(billing)
    .catch((err) => {
      console.log(err)
      throw new Error("Error al crear la facturación.");
    });
  const newBilling = await adminDb.collection("Billings").doc(billingDoc.id).get()
    .catch((err) => {
      console.log(err)
      throw new Error("Error al obtener la facturación.");
    });

  return newBilling
}
exports.createBilling = async (request, response) => {
  const restaurantId = request.body.restaurantId;
  let billingPeriodStart = request.body.periodStart;
  let billingPeriodEnd = request.body.periodEnd;
  const manualAdjustment = request.body.manualAdjustment ? request.body.manualAdjustment : 0;

  // Validations
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  if(!billingPeriodStart){
    return response.status(400).json({
      message: 'No se encontró la fecha de inicio facturación.'
    });
  }
  if(!dayjs(billingPeriodStart).isValid()) {
    return response.status(400).json({
      message: 'Fecha de inicio facturación inválida.'
    });
  }
  if(billingPeriodEnd && !dayjs(billingPeriodEnd).isValid()){
    return response.status(400).json({
      message: 'Fecha de fin facturación inválida.'
    });
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

  // Set period dates
  billingPeriodStart = dayjs(billingPeriodStart).startOf('month').toDate();
  billingPeriodEnd = billingPeriodEnd || dayjs(billingPeriodStart).endOf('month').toDate();

  // Create billing
  const billing = await createRestaurantBilling(
    restaurantId, 
    billingPeriodStart, 
    billingPeriodEnd, 
    manualAdjustment
  ).catch((err) => {
    return response.status(500).json({
      message: err.message
    });
  });

  // Return new object
  return response.json({
    id: billing.id,
    ...billing.data(),
    periodStart: billing.get("periodStart").toDate(),
    periodEnd: billing.get("periodEnd").toDate(),
    createdAt: billing.get("createdAt").toDate(),
    updatedAt: billing.get("updatedAt").toDate()
  });
}
const getRestaurantBilling = async (restaurantId = undefined, queryParams = {}) => {
  const billingPeriodStart = queryParams.periodStart;
  const billingPeriodEnd = queryParams.periodEnd;
  const manualAdjustment = queryParams.manualAdjustment ? queryParams.manualAdjustment : 0;
  const filtersList = [];

  // Validations
  if(!restaurantId) {
    throw new Error("ID del restaurante obligatorio.");
    //return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  if(billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    filtersList.push(where("periodStart", ">=", dayjs(billingPeriodStart).toDate()))
  }
  if(billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    filtersList.push(where("periodStart", "<=", dayjs(billingPeriodEnd).toDate()))
    //filtersList.push(where("periodEnd", "<=", dayjs(billingPeriodEnd).toDate()))
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    throw new Error("Ajuste manual inválido.");
    // return response.status(400).json({
    //   message: 'Ajuste manual inválido.'
    // });
  }

  // Get restaurant
  const restaurantDoc = doc(db, "Restaurants", restaurantId);
  const restaurant = await getDoc(restaurantDoc).catch((err) => {
    throw new Error("Restaurante no encontrado.");
    //return response.status(404).json({ message: "Restaurante no encontrado." });
  });

  // Get Billings
  const billingsQuery = query(
    collection(db, "Billings"), 
    where("restaurantId", "==", restaurant.id),
    ...filtersList,
    orderBy("periodStart", "desc")
  );
  const billings = await getDocs(billingsQuery).catch((err) => {
    throw new Error("Error al obtener las facturaciones.");
    //return response.status(500).json({ message: "Error al obtener las facturaciones." });
  });
  if(billings.empty){
    return [];
  }

  //
  const billingsList = [];
  for(const billing of billings.docs) {
    let restaurantName;
    const restaurant = await getDoc(doc(db, "Restaurants", billing.get("restaurantId"))).catch((err) => {
      restaurantName = 'Error al obtener el restaurante';
    });
    restaurantName = restaurant ? restaurant.get("name") : 'Restaurante no encontrado';

    billingsList.push({
      id: billing.id,
      ...billing.data(),
      paidQuantity: billing.get('paidQuantity') ? billing.get('paidQuantity') : 0,
      debtQuantity: billing.get('debtQuantity') ? billing.get('debtQuantity') : 0,
      restaurantName,
      createdAt: billing.data().createdAt.toDate(),
      periodStart: billing.data().periodStart.toDate(),
      periodEnd: billing.data().periodEnd.toDate(),
      paidAt: billing.data().paidAt ? billing.data().paidAt.toDate() : null,
    })
  }

  return billingsList;
}
exports.getBillings = async (request, response) => {
  const restaurantBillings = await getRestaurantBilling(
    request.params.restaurantId,
    {
      periodStart: request.query.periodStart,
      periodEnd: request.query.periodEnd,
      manualAdjustment: request.query.manualAdjustment
    }
  ).catch((err) => {
    //console.log(err)
    return response.status(500).json({ message: err.message });
  });
  
  // Return
  return response.json(restaurantBillings);
}
exports.updateBilling = async (request, response) => {
  const billingId = request.params.billingId;
  if(!billingId) {
    return response.status(400).json({ message: "ID de la factura obligatorio." });
  }

  // Get Billing
  const billing = await getDoc(doc(db, "Billings", billingId));
  if(!billing.exists()){
    return response.status(404).json({ message: "Factura no encontrada." });
  }
  const paidQuantity = !isNaN(request.body.paidQuantity) ? Number(request.body.paidQuantity) : (billing.get('paidQuantity') || 0);
  const manualAdjustment = !isNaN(request.body.manualAdjustment) ? Number(request.body.manualAdjustment) : billing.get('manualAdjustment');
  const isPaid = request.body.isPaid != undefined ? request.body.isPaid : billing.get('isPaid');

  // Validations
  if(paidQuantity && isNaN(paidQuantity)) {
    return response.status(400).json({ message: "La cantidad de pago debe ser un número." });
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'La cantidad de ajuste manual debe ser un número.'
    });
  }

  // Calculate balance
  let calculatedBalance = 0;
  for(const redemptionId of billing.get('redemptions')) {
    // Get Redemption
    const redemption = await getDoc(doc(db, "DealRedemptions", redemptionId));
    if(!redemption.exists()){
      continue;
    }

    const averageTicket = redemption.get("averageTicket") ? parseFloat(redemption.get("averageTicket")) : 0;
    const takeRate = redemption.get("takeRate") ? parseFloat(redemption.get("takeRate")) : DEFAULT_TAKE_RATE;
    calculatedBalance += averageTicket * takeRate;
  }

  // Calculate total balance
  const totalBalance = calculatedBalance + manualAdjustment;
  const debtQuantity = totalBalance - paidQuantity;

  // Update Billing
  const updateObject = {
    ...(!isNaN(paidQuantity)) && {paidQuantity},
    ...(!isNaN(manualAdjustment)) && {manualAdjustment},
    isPaid: isPaid,
    totalBalance: totalBalance,
    debtQuantity,
    calculatedBalance,
    updatedAt: dayjs().toDate()
  }
  console.log(manualAdjustment, updateObject)
  await updateDoc(doc(db, "Billings", billingId), updateObject).catch((err) => {
    return response.status(500).json({ message: "Error al actualizar la facturación." });
  });

  // Get updated Billing
  const newBilling = await getDoc(doc(db, "Billings", billingId)).catch((err) => {
    return response.status(500).json({ message: "Error al obtener la facturación." });
  });

  // Return new object
  return response.json({
    id: newBilling.id,
    ...newBilling.data(),
    periodStart: newBilling.get("periodStart").toDate(),
    periodEnd: newBilling.get("periodEnd").toDate(),
    createdAt: newBilling.get("createdAt").toDate(),
    updatedAt: newBilling.get("updatedAt").toDate()
  });
};
exports.exportsPartnerBillings = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;
  
  // Filter by date range
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  let range_init = dayjs().set('month', 0).set('date', 1).toDate();
  if (billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    range_init = dayjs(dayjs(billingPeriodStart).toISOString())
      .toDate();
  }
  let range_end = dayjs().set('year', dayjs().year()+1).set('month',0).set('date', 0).toDate();
  if (billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    range_end = dayjs(billingPeriodEnd)
      .hour(23)
      .minute(59)
      .second(59)
      .toDate();
  }

  // Get restaurants
  const restaurantDoc = await getDoc(doc(db, "Restaurants", restaurantId))
  .catch((err) => {
    return response.status(500).json({ message: "Error al obtener los restaurantes." });
  });

  // Early return if no restaurants found
  if(!restaurantDoc.exists()){
    return response.status(404).json({ message: "No se encontraron restaurantes." });
  }
  console.log('Restaurant: ', restaurantDoc.get('name'));
  
  // Configure csv
  const columns = [
    "restaurant",
    "billingPeriod",
    "totalDeals",
    "redemptions",
    "calculatedBalance",
    "manualAdjustment",
    "totalBalance",
    "paidQuantity",
    "debtQuantity",
    "isPaid"
  ];
  const stringifier = stringify({ header: true, columns: columns });
  stringifier.on('finish', function(){
    //return response.status(200).json({status: 'ok'})//.end(csvData);
  });
  
  // Configure response headers
  const filename = `billing_from_db.csv`;
  response.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  response.setHeader("Content-Type", "text/csv");
  // response.setHeader("Cache-Control", "no-cache");
  // response.setHeader("Pragma", "no-cache");
  response.attachment(filename);

  // Get Billings
  const restaurantBillings = await getDocs(query(
    collection(db, "Billings"), 
    where("restaurantId", "==", restaurantDoc.id),
    where("periodStart", ">=", range_init),
    where("periodStart", "<=", range_end),
    //orderBy("createdAt", "desc"),
    orderBy("periodStart", "desc")
  )).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las facturaciones." });
  });
  console.log(range_init, range_end, restaurantBillings.size)

  // Loop throught each billing
  for(const billing of restaurantBillings.docs ){
    const billingPeriodStartDate = billing.get("periodStart").toDate();
    const billingPeriodEndDate = billing.get("periodEnd").toDate();
    console.log('--- Billing: ', dayjs(billingPeriodStartDate).format('MM'), ' - ', dayjs(billingPeriodEndDate).format('MM'));

    // Get Deals
    const deals = await getDocs(query(
      collection(db, "Deals"), 
      where("restaurantId", "==", restaurantDoc.id),
      where("createdAt", ">=", billingPeriodStartDate),
      where("createdAt", "<=", billingPeriodEndDate),
      orderBy("createdAt", "desc")
    )).catch((err) => {
      console.log(err)
      return response.status(500).json({ message: "Error al obtener las ofertas." });
    });

    // Get Redemptions
    const redemptions = await getDocs(query(
      collection(db, "DealRedemptions"),
      where("restaurantId", "==", restaurantDoc.id),
      where("createdAt", ">=", billingPeriodStartDate),
      where("createdAt", "<=", billingPeriodEndDate),
    )).catch((err) => {
      console.log(err)
      return response.status(500).json({ message: "Error al obtener las ofertas." });
    })

    //
    stringifier.write({
      restaurant: restaurantDoc.get('name'),
      billingPeriod: dayjs(billingPeriodStartDate).format('MM/YYYY'),
      totalDeals: deals.size,
      redemptions: redemptions.size,
      calculatedBalance: billing.get('calculatedBalance') || 0,
      manualAdjustment: billing.get('manualAdjustment') || 0,
      totalBalance: billing.get('totalBalance') || 0,
      paidQuantity: billing.get('paidQuantity') || 0,
      debtQuantity: billing.get('debtQuantity') || 0,
      isPaid: billing.get('isPaid')
    });
  }

  // Write csv
  stringifier.pipe(response);
  stringifier.end();
}
exports.exportsPartnerBillingDetails = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;
  
  // Filter by date range
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  let range_init = dayjs().set('month', 0).set('date', 1).toDate();
  if (billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    range_init = dayjs(dayjs(billingPeriodStart).toISOString())
      .toDate();
  }
  let range_end = dayjs().set('year', dayjs().year()+1).set('month',0).set('date', 0).toDate();
  if (billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    range_end = dayjs(billingPeriodEnd)
      .hour(23)
      .minute(59)
      .second(59)
      .toDate();
  }

  // Get restaurants
  const restaurantDoc = await getDoc(doc(db, "Restaurants", restaurantId))
  .catch((err) => {
    return response.status(500).json({ message: "Error al obtener los restaurantes." });
  });

  // Early return if no restaurants found
  if(!restaurantDoc.exists()){
    return response.status(404).json({ message: "No se encontraron restaurantes." });
  }
  
  // Configure csv
  const columns = [
    'restaurant',
    'dealId',
    'createdAt',
    'startsAt',
    'expiresAt',
    'includeDrinks',
    'type',
    'details',
    'redeemed',
    'redeemedAt',
    'userRedemption',
    'reservationPeople',
    'averageTicket',
    'takeRate'
  ];
  const stringifier = stringify({ header: true, columns: columns });
  stringifier.on('finish', function(){
    //return response.status(200).json({status: 'ok'})//.end(csvData);
  });
  
  // Configure response headers
  const filename = `saved_from_db.csv`;
  response.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  response.setHeader("Content-Type", "text/csv");
  // response.setHeader("Cache-Control", "no-cache");
  // response.setHeader("Pragma", "no-cache");
  response.attachment(filename);

  // Get Redemptions
  const redemptions = await getDocs(query(
    collection(db, "DealRedemptions"),
    where("restaurantId", "==", restaurantDoc.id),
    where("createdAt", ">=", range_init),
    where("createdAt", "<=", range_end),
  )).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las redenciones." });
  })

  // Get Deals
  const deals = await getDocs(query(
    collection(db, "Deals"), 
    where("restaurantId", "==", restaurantDoc.id),
    where("createdAt", ">=", range_init),
    where("createdAt", "<=", range_end),
    orderBy("createdAt", "desc"),
  )).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las ofertas." });
  });

  // Loop throught each deal
  for(const deal of deals.docs ){
    // Get redemptions
    let redemptionDetails = {
      redeemed: false,
      redeemedAt: 'N/A',
      userRedemption: 'N/A',
      reservationPeople: 'N/A',
      averageTicket: 'N/A',
    }
    const redemption = redemptions.docs.find((redemption) => redemption.get('dealId') == deal.id);
    if(redemption){
      // console.log(deal.id, redemption.id, redemption.get('reservationId'))
      const averageTicket = redemption.get('averageTicket');
      const takeRate = `${redemption.get('takeRate') * 100} %`;

      // Get user details
      let userRedemption = 'N/A';
      if(redemption.get('customerId')){
        const user = await getDoc(doc(db, "Users", redemption.get('customerId'))).catch((err) => {
          userRedemption = 'N/A';
        });
        userRedemption = user.get('email');
      }

      // Get reservation details
      let reservationPeople = 'N/A';
      if(redemption.get('reservationId')){
        const reservation = await getDoc(doc(db, "Reservations", redemption.get('reservationId'))).catch((err) => {
          reservationPeople = 'N/A';
        });
        reservationPeople = reservation.get("count");
      }

      // Format redemption details
      redemptionDetails = {
        redeemed: true,
        redeemedAt: dayjs(redemption.get("createdAt").toDate()).format('DD/MM/YYYY HH:mm:ss'),
        userRedemption,
        reservationPeople,
        averageTicket,
        takeRate
      }
    }

    //
    stringifier.write({
      restaurant: restaurantDoc.get('name'),
      dealId: deal.id,
      createdAt: dayjs(deal.get("createdAt").toDate()).format('DD/MM/YYYY'),
      startsAt: dayjs(deal.get("startsAt").toDate()).format('DD/MM/YYYY HH:mm:ss'),
      expiresAt: dayjs(deal.get("expiresAt").toDate()).format('DD/MM/YYYY HH:mm:ss'), 
      includeDrinks: deal.get('include_drinks') ? 'Yes' : 'No',
      type: deal.get('dealType') == DEAL_TYPE.DISCOUNT ? 'Descuento' : 'Promoción',
      details: deal.get('dealType') == DEAL_TYPE.DISCOUNT ? `${deal.get('discount') * 100} %` : deal.get('details'),
      ...redemptionDetails
    });
  }

  // Write csv
  stringifier.pipe(response);
  stringifier.end();
}
exports.exportsPartnerBillings2 = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;
  
  // Filter by date range
  let range_init = dayjs().set('month', 0).set('date', 1).toDate();
  if (billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    range_init = dayjs(dayjs(billingPeriodStart).toISOString())
      .toDate();
  }
  let range_end = dayjs().set('year', dayjs().year()+1).set('month',0).set('date', 0).toDate();
  if (billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    range_end = dayjs(billingPeriodEnd)
      .hour(23)
      .minute(59)
      .second(59)
      .toDate();
  }

  // Get restaurants
  const restaurantDocs = await getDocs(query(
    collection(db, "Restaurants"),
  )).catch((err) => {
    return response.status(500).json({ message: "Error al obtener los restaurantes." });
  });

  // Early return if no restaurants found
  if(!restaurantDocs.size){
    return response.status(404).json({ message: "No se encontraron restaurantes." });
  }
  
  // Configure csv
  const columns = [
    "restaurant",
    "billingPeriod",
    "dealId",
    "redemptionDate",
    "averageTicket",
    "takeRate",
    "total"
  ];
  const stringifier = stringify({ header: true, columns: columns });
  stringifier.on('finish', function(){
    //return response.status(200).json({status: 'ok'})//.end(csvData);
  });
  
  // Configure response headers
  const filename = `saved_from_db.csv`;
  response.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  response.setHeader("Content-Type", "text/csv");
  response.attachment(filename);

  // Get billings from each restaurant
  for(const restaurantDoc of restaurantDocs.docs){
    console.log('Restaurant: ', restaurantDoc.get('name'));

    // Get Billings
    const billingsQuery = query(
      collection(db, "Billings"), 
      where("restaurantId", "==", restaurantDoc.id),
      where("createdAt", ">=", range_init),
      where("createdAt", "<=", range_end),
      orderBy("createdAt", "desc"),
      orderBy("periodStart", "desc")
    );
    const restaurantBillings = await getDocs(billingsQuery).catch((err) => {
      console.log(err)
      return response.status(500).json({ message: "Error al obtener las facturaciones." });
    });

    // Loop throught each billing
    for(const billing of restaurantBillings.docs ){
      const billingPeriodStartDate = billing.get("periodStart").toDate();
      const billingPeriodEndDate = billing.get("periodEnd").toDate();
      console.log('--- Billing: ', dayjs(billingPeriodStartDate).format('MM'), ' - ', dayjs(billingPeriodEndDate).format('MM'));

      // Get Deals
      const billingDeals = await getDocs(query(
        collection(db, "DealRedemptions"),
        where("restaurantId", "==", restaurantDoc.id),
        where("createdAt", ">=", billingPeriodStartDate),
        where("createdAt", "<=", billingPeriodEndDate),
      )).catch((err) => {
        console.log(err)
        return response.status(500).json({ message: "Error al obtener las ofertas." });
      })

      // Loop through every deal
      for(const deal of billingDeals.docs){
        const redemptionDate = deal.get("createdAt").toDate();
        console.log('------ Deal: ', deal.id, ' - ', dayjs(redemptionDate).format('DD MM YY'), ' - ', deal.get("averageTicket"), ' - ', deal.get("takeRate"), ' - ', deal.get("averageTicket") * deal.get("takeRate"));
        
        //
        stringifier.write({
          restaurant: restaurantDoc.get('name'),
          billingPeriod: dayjs(billingPeriodStartDate).format('MM'),
          dealId: deal.id,
          redemptionDate: dayjs(redemptionDate).format('DD MM YY'),
          averageTicket: deal.get("averageTicket"),
          takeRate: deal.get("takeRate"),
          total: deal.get('total')
        });
      }
    }
  }

  // Write csv
  stringifier.pipe(response);
  stringifier.end();
}
exports.searchRestaurantsBillings = async (request, response) => {
  const searchResults = await getRestaurantsList(
    request.body
  ).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Error al obtener los restaurantes.',
    });
  });

  // Early return if there are no results
  if(!searchResults.hits.length) {
    return response.status(200).json([]);
  }

  // Format restaurant docs
  let docs = searchResults.hits;
  let restaurantBillings = [];
  for (let doc of docs) {
    //
    const billings = await getRestaurantBilling(
      doc.id,
      {
        periodStart: request.query.periodStart,
        periodEnd: request.query.periodEnd,
        manualAdjustment: request.query.manualAdjustment
      }
    ).catch((err) => {
      console.log(err)
      return response.status(500).json({ message: err.message });
    });

    // Add restaurant billing to array
    restaurantBillings.push(...billings);
  }

  // Return
  return response.json(restaurantBillings);
}

//
exports.syncAuthToFirestoreUsers = async (req, res) => {
  try {
    const usersAuth = await adminAuth.listUsers();
    if(usersAuth.users.length > 0) {
      usersAuth.users.forEach(async (user) => {
        const userDoc = await getDoc(doc(db, "Users", user.uid));
        if(!userDoc.exists()) {
          await setDoc(doc(db, "Users", user.uid), {
            authId: user.uid,
            email: user.email,
            firstName: user.displayName ? user.displayName : '',
            lastName: user.lastName ? user.lastName : '',
            role: user.customClaims ? user.customClaims.role : USER_ROLES.CUSTOMER,
            createdAt: dayjs().toDate(),
            updatedAt: dayjs().toDate()
          }).catch((err) => {
            console.log(err);
          });
        }
      });
    }
    // Response
    return res.json({
      message: "Synced successfully"
    });
  } catch (err) {
    functions.logger.error(err);
    return handleError(res, err);
  }
};
exports.formatRedemptions = async (request, response) => {
  const redemptions = await getDocs(collection(db, "DealRedemptions"));
  for(const redemption of redemptions.docs) {
    const deal = await getDoc(
      doc(db, "Deals", redemption.get("dealId"))
    ).catch((err) => { console.log(err); return response.status(500) });
    
    if(!deal.exists()) {
      console.log('Deal does not exists. Deleting redemption...');
      deleteDoc(doc(db, "DealRedemptions", redemption.id));
      continue
    }
    
    const restaurant = await getDoc(doc(db, "Restaurants", deal.get("restaurantId")))
      .catch((err) => { console.log(err); return response.status(500) });

    await updateDoc(redemption.ref, {
      takeRate: .1,
      averageTicket: redemption.get("averageTicket") ? redemption.get("averageTicket") : 100,
      restaurantId: redemption.get("restaurantId") ? redemption.get("restaurantId") : restaurant.id,
    }).catch((err) => { console.log(err); return response.status(500) });
  }

  return response.status(200);
}

exports.billingsPast = async (request, response) => {
  const initialMonth = 6;
  const restaurants = await getDocs(collection(db, "Restaurants"));

  // Loop through restaurants
  for(const restaurant of restaurants.docs) {
    // Loop through months sequentially
    for(let currentMonth = initialMonth; currentMonth < dayjs().get('month'); currentMonth++) {
      const currentPeriod = dayjs().set('month', currentMonth);
      const periodStart = currentPeriod.startOf('month').toDate();
      const periodEnd = currentPeriod.endOf('month').toDate();
      
      // Create billing for corresponding period
      await createRestaurantBilling(restaurant.id, periodStart, periodEnd)
        .catch((err) => { 
          console.log(err)
          return response.status(500).json({ message: err.message });
         });
    }
  }

  return response.json({message: 'Done'});
}
exports.createLastMonthBillings = async () => {
  const periodStart = dayjs().subtract(1, 'month').startOf('month').toDate();
  const periodEnd = dayjs(periodStart).endOf('month').toDate();
  const restaurants = await adminDb.collection('Restaurants').get();
  // const restaurants = await getDocs(collection(db, "Restaurants"));

  // Loop through restaurants
  for(const restaurant of restaurants.docs) {
    // Create billing for corresponding period
    await createRestaurantBilling(restaurant.id, periodStart, periodEnd)
      .catch((err) => { 
        console.log(err);
        throw new Error('Error al crear la factura.');
      });
  }

  console.log('restaurant.id', periodStart, periodEnd)
  return null;
}

//------------ HELPERS ------------//
// Update all reservations
exports.updateAllReservations = async (request, response) => {
  // Consistent timestamp
  const now = dayjs();
  const nowWithReminderOffset = now.add(15, 'minutes').toDate();
  console.log(dayjs(nowWithReminderOffset).format('YYYY-MM-DD HH:mm:ss'))

  // Get expired reservations
  const reservationsCollectionRef = adminDb.collection('Reservations')
      .where('reservationDate', '<=', nowWithReminderOffset)
      .where('active', '==', true)
      .where('reminderNotificationSent', '==', false);
  const reservationsCollection = await reservationsCollectionRef.get();
  
  //
  for(let reservation of reservationsCollection.docs) {
    console.log('reservation', reservation.id, dayjs.utc(reservation.get('reservationDate').toDate()).format('YYYY-MM-DD HH:mm:ss'))
  }
  return response.json({ state: "No reservations found." });


  const reservationsReference = collection(db, "Reservations");
  const reservations = await getDocs(query(reservationsReference));

  if (reservations.size) {
    for (const reservation of reservations.docs) {
      //const restaurantData = restaurant.data();
      await updateDoc(reservation.ref, {
        ...request.body,
      }).catch((err) => {
        console.error(err);
        return response.status(500).json({
          ...err,
          message: "Error al actualizar la reservación.",
        });
      });
    }
    return response.json({ state: "Updated reservations successfully." });
  }

  ///
  return response.json({ state: "No reservations found." });
};

// Update all deals
exports.updateAllDeals = async (request, response) => {
  // Get expired deals
  const dealsCollectionRef = adminDb.collection('Deals');
  const dealsCollection = await dealsCollectionRef.get();
  
  //
  for(let deal of dealsCollection.docs) {
    const restaurant = await adminDb
      .collection('Restaurants')
      .doc(deal.get('restaurantId'))
      .get();
    let restaurantName = 'Restaurante no encontrado';

    if(restaurant.exists) {
      restaurantName = restaurant.get('name');
      // console.log('Restaurant does not exists.');
      // await adminDb.collection('Deals').doc(deal.id).delete();
      // continue
    }
    await adminDb.collection('Deals').doc(deal.id).update({
      restaurant: null
    });
    console.log('deal', restaurantName, deal.id);
  }
  return response.json({ state: "No deals found." });
};

// Update all users
exports.updateAllUsers = async (request, response) => {
  // Get users
  let usersList = await adminAuth.listUsers()
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: 'Ocurrió un error al obtener los usuarios.',
      });
    });

  //
  if (usersList.users.length) {
    let counter = 0
    //
    for (const user of usersList.users) {
      console.log(user)

      const dbUser = (await getDoc(doc(db, "Users", user.uid)));
      if(!dbUser.exists()) {
        console.log('user not found')
        continue
      }

      await updateDoc(
        doc(db, "Users", user.uid), {
        emailVerified: user.emailVerified,
      }).catch((err) => {
        console.error(err);
        return response.status(500).json({
          ...err,
          message: "Error al actualizar la reservación.",
        });
      });
    }
    return response.json({ state: "Updated users successfully." });
  }

  ///
  return response.json({ state: "No users found." });
};



