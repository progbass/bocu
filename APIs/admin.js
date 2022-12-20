const { stringify } = require("csv-stringify");
const {
  createUserWithEmailAndPassword,
  sendEmailVerification,
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
  limit
} = require("firebase/firestore");
const functions = require("firebase-functions");
const dayjs = require("dayjs");
const { getNewBillingObject } = require("../utils/billing-utils");
const { USER_ROLES, DEFAULT_TAKE_RATE, LISTING_CONFIG, SEARCH_CONFIG } = require("../utils/app-config");
const { DEAL_TYPE } = require("../utils/deals-utils");
const getCurrentUser = require("../utils/getCurrentUser");
const algoliasearch = require("algoliasearch");

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

  // updateDoc(
  // 	doc(db, `/Users/`, request.params.userId),
  // 	request.body
  // ).then((doc) => {
  // 		response.json({message: 'Updated successfully'});
  // 	})
  // 	.catch((err) => {
  // 		console.error(error);
  // 		return response.status(500).json({
  // 			message: "Cannot Update the value"
  // 		});
  // 	});
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
    ...userParams,
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
      id: doc.objectID,
      rating,
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
    return response.status(204).json([]);
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

// Billing CRUD
const createRestaurantBilling = async (restaurantId, periodStart, periodEnd, manualAdjustment = 0) => {
  // Get restaurant
  const restaurant = await getDoc(
    doc(db, "Restaurants", restaurantId)
  ).catch((err) => {
    throw new Error("Restaurante no encontrado.");
  });

  // Get Deals whithin period
  const dealsQuery = query(
    collection(db, "Deals"),
    where("restaurantId", "==", restaurantId),
    where("createdAt", ">=", dayjs(periodStart).toDate()),
    where("createdAt", "<=", dayjs(periodEnd).toDate()),
    orderBy("createdAt", "desc")
  )
  const deals = await getDocs(dealsQuery).catch((err) => {
    throw new Error("Error al obtener las ofertas.");
  });

  // Get Redemptions
  const redemptionsQuery = query(
    collection(db, "DealRedemptions"),
    where("restaurantId", "==", restaurantId),
    where("createdAt", ">=", dayjs(periodStart).toDate()),
    where("createdAt", "<=", dayjs(periodEnd).toDate()),
    orderBy("createdAt", "desc")
  )
  const redemptions = await getDocs(redemptionsQuery).catch((err) => {
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
    }
  );

  // Create billing
  const billingDoc = await addDoc(collection(db, "Billings"), billing).catch((err) => {
    throw new Error("Error al crear la facturación.");
  });
  const newBilling = await getDoc(billingDoc).catch((err) => {
    throw new Error("Error al obtener la facturación.");
  });

  return newBilling
}
exports.createBilling = async (request, response) => {
  const restaurantId = request.body.restaurantId;
  const billingPeriodStart = request.body.periodStart;
  const billingPeriodEnd = request.body.periodEnd;
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
  if(!billingPeriodEnd){
    return response.status(400).json({
      message: 'No se encontró la fecha de fin facturación.'
    });
  }
  if(!dayjs(billingPeriodEnd).isValid()) {
    return response.status(400).json({
      message: 'Fecha de fin facturación inválida.'
    });
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

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
    createdAt: billing.get("createdAt").toDate()
  });
}
exports.getBillings = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;
  const manualAdjustment = request.query.manualAdjustment ? request.query.manualAdjustment : 0;
  const filtersList = [];

  // Validations
  if(!restaurantId) {
    return response.status(400).json({ message: "ID del restaurante obligatorio." });
  }
  if(billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    filtersList.push(where("periodStart", ">=", dayjs(billingPeriodStart).toDate()))
  }
  if(billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    filtersList.push(where("periodEnd", "<=", dayjs(billingPeriodEnd).toDate()))
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

  // Get restaurant
  const restaurantDoc = doc(db, "Restaurants", restaurantId);
  const restaurant = await getDoc(restaurantDoc).catch((err) => {
    return response.status(404).json({ message: "Restaurante no encontrado." });
  });

  // Get Billings
  const billingsQuery = query(
    collection(db, "Billings"), 
    where("restaurantId", "==", restaurant.id),
    ...filtersList,
    orderBy("periodStart", "desc")
  );
  const billings = await getDocs(billingsQuery).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las facturaciones." });
  });

  if(billings.empty){
    return response.status(200).json([]);
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

  // Return
  return response.json(billingsList);
}
exports.updateBilling = async (request, response) => {
  /*
  const billingId = request.params.billingId;
  //const redemptions = request.body.redemptions || [];
  const billingPeriodStart = request.body.periodStart;
  const billingPeriodEnd = request.body.periodEnd;
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
  if(!billingPeriodEnd){
    return response.status(400).json({
      message: 'No se encontró la fecha de fin facturación.'
    });
  }
  if(!dayjs(billingPeriodEnd).isValid()) {
    return response.status(400).json({
      message: 'Fecha de fin facturación inválida.'
    });
  }
  if(manualAdjustment && isNaN(manualAdjustment)){
    return response.status(400).json({
      message: 'Ajuste manual inválido.'
    });
  }

  // Get restaurant
  const restaurantDoc = doc(db, "Restaurants", restaurantId);
  const restaurant = await getDoc(restaurantDoc).catch((err) => {
    return response.status(404).json({ message: "Restaurante no encontrado." });
  });

  // Get Deals
  const redemptionsQuery = query(
    collection(db, "DealRedemptions"),
    where("restaurantId", "==", restaurant.id),
    where("createdAt", ">=", dayjs(billingPeriodStart).toDate()),
    where("createdAt", "<=", dayjs(billingPeriodEnd).toDate()),
    orderBy("createdAt", "desc")
  )
  const redemptions = await getDocs(redemptionsQuery).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las ofertas." });
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

  // Billing object model
  const billing = getNewBillingObject(
    restaurant.id,
    dayjs(billingPeriodStart).toDate(),
    dayjs(billingPeriodEnd).toDate(),
    {
      redemptions: redemptions.docs.map((deal) => deal.id),  
      calculatedBalance,
      manualAdjustment,
      totalBalance,
    }
  );

  // Create billing
  const billingDoc = await addDoc(collection(db, "Billings"), billing).catch((err) => {
    return response.status(500).json({ message: "Error al crear la facturación." });
  });
  const newBilling = await getDoc(billingDoc).catch((err) => {
    return response.status(500).json({ message: "Error al obtener la facturación." });
  });

  // Return new object
  return response.json({
    id: newBilling.id,
    ...newBilling.data(),
    periodStart: newBilling.get("periodStart").toDate(),
    periodEnd: newBilling.get("periodEnd").toDate(),
    createdAt: newBilling.get("createdAt").toDate()
  }*/
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
      const periodStart = currentPeriod.startOf('month');
      const periodEnd = currentPeriod.endOf('month');
      
      // Create billing for corresponding period
      await createRestaurantBilling(restaurant.id, periodStart, periodEnd)
        .catch((err) => { 
          return response.status(500).json({ message: err.message });
         });
    }
  }

  return response.json({message: 'Done'});
}
