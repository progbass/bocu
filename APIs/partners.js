const functions = require("firebase-functions");
const {
  Timestamp,
  addDoc,
  getDoc,
  getDocs,
  doc,
  collection,
  query,
  where,
  updateDoc,
  startAfter,
  startAt,
  endAt,
  limit,
  orderBy,
} = require("firebase/firestore");
const { CustomError } = require("../utils/CustomError");
const { db, admin, adminAuth } = require("../utils/admin");
const config = require("../utils/config");
const { slugifyString } = require("../utils/formatters");
const busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
const readXlsxFile = require("read-excel-file/node");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc')
const isBetween = require('dayjs/plugin/isBetween');
dayjs.extend(isBetween)
dayjs.extend(utc)
const {
  RESERVATION_STATUS,
  getReservationStatusDetails,
} = require("../utils/reservations-utils");
const {
  DEAL_EXPIRY_DEFAULT_OFFSET_HOURS,
  DEAL_TYPE,
  DEAL_FREQUENCY_TYPE,
  isDealValid,
  isDealActive,
  isDealRecurrent
} = require("../utils/deals-utils");
const { getNewRestaurantObject } = require("../utils/restaurant-utils");
const { uploadFiletoBucket } = require("../utils/upload-utils");
const {
  DEFAULT_TAKE_RATE,
  MAX_CATEGORIES,
  LISTING_CONFIG,
  MAX_RESTAURANTS_PER_USER,
} = require("../utils/app-config");

// RESTAURANTS CRUD
exports.createRestaurant = async (request, response) => {
  const restaurantCollection = collection(db, "Restaurants");

  // Validate that restaurant does not exists.
  const existingRestaurant = await getDocs(
    query(restaurantCollection, where("name", "==", request.body.name))
  );
  if (existingRestaurant.size > 0) {
    return response.status(409).json({ message: "El restaurante ya existe." });
  }

  // Validate that restaurant does not exists.
  const currentUserRestaurant = await getDocs(
    query(restaurantCollection, where("userId", "==", request.user.uid))
  );
  if (currentUserRestaurant.size > 0) {
    return response
      .status(403)
      .json({ message: "Este usuario ya cuenta con un restaurante." });
  }

  // Create restaurant.
  const newRestaurantItem = getNewRestaurantObject(
    request.body.name,
    request.user.email,
    request.user.uid,
    request.body
  );
  addDoc(restaurantCollection, newRestaurantItem)
    .then(async (documentRef) => {
      // Get new document
      getDoc(documentRef).then(async (documentSnapshot) => {
        // Evaluate if restaurant has
        // the minimum requirements defined by the business
        const hasMinimumRequirements = !hasMissingRequirements(
          documentSnapshot.data()
        );

        // Generate QR code
        const publicUrl = await generateQR(
          documentRef.id,
          `Restaurants/${documentSnapshot.data().slug}/qr_${
            documentRef.id
          }-${new Date().getTime()}.png`
        );

        // Update restaurant info
        await updateDoc(documentRef, {
          qrCode: publicUrl,
          hasMinimumRequirements,
        });

        // return new document
        const updatedDocument = await getDoc(documentRef);
        const responseItem = {
          id: documentRef.id,
          ...updatedDocument.data(),
        };
        return response.json(responseItem);
      });
    })
    .catch((err) => {
      console.error(err);
      return response
        .status(500)
        .json({ ...err, message: "Error al crear el restaurante." });
    });
};
exports.editPartnerRestaurant = async (request, response) => {
  let restaurantReference = doc(db, "Restaurants", request.params.restaurantId);
  let restaurant = await getDoc(restaurantReference);

  // Validate that restaurant exists.
  if (!restaurant.exists()) {
    return response
      .status(404)
      .json({ message: "No se encontró el restaurante." });
  }

  // Limit number of categories
  let categories = restaurant.data().categories;
  if (request.body.categories) {
    categories = request.body.categories || [];
    if (categories.length > MAX_CATEGORIES) {
      return response.status(409).json({
        message: `Puedes seleccionar máximo [${MAX_CATEGORIES}] categorías.`,
      });
    }
  }

  // Ensure averageTicket is a number
  let averageTicket = restaurant.data().averageTicket;
  if (request.body.averageTicket) {
    averageTicket = parseFloat(averageTicket);
  }

  // Update document
  await updateDoc(restaurantReference, {
    ...request.body,
    categories,
    averageTicket
  }).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: "Error al actualizar el restaurante.",
    });
  });

  // Get updated record
  restaurant = await getDoc(restaurantReference);
  let restaurantData = restaurant.data();

  // Evaluate if restaurant has
  // the minimum requirements defined by the business
  const hasMinimumRequirements = !hasMissingRequirements(restaurantData);

  // Update restaurant 'minimum requirements' property
  await updateDoc(restaurantReference, { hasMinimumRequirements }).catch(
    (err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: "Error al actualizar el restaurante",
      });
    }
  );

  // Get updated record
  restaurant = await getDoc(restaurantReference);

  // Response
  response.json({
    id: restaurant.id,
    ...restaurant.data()
  });
};
exports.getPartnerRestaurant = async (request, response) => {
  getDoc(doc(db, "Restaurants", request.params.restaurantId))
    .then((doc) => {
      if (!doc.exists()) {
        return response.status(404).json({
          message: "No se encontró el restaurante.",
        });
      }

      //
      return response.json({
        id: doc.id,
        ...doc.data(),
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: 'Ocurrió un error al obtener el restaurante.',
      });
    });
};
exports.getPartnerRestaurants = async (request, response) => {
  getDocs(
    query(
      collection(db, "Restaurants"),
      where("userId", "==", request.user.uid),
      where("active", "==", true),
      limit(MAX_RESTAURANTS_PER_USER)
    )
  )
    .then((data) => {
      let restaurants = [];
      data.forEach((doc) => {
        restaurants.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Response
      return response.json(restaurants);
    })
    .catch((err) => {
      console.error(err);
      return response
        .status(500)
        .json({
          ...err,
          message: "Ocurrió un error al obtener los restaurantes.",
        });
    });
};
exports.deactivatePartnerRestaurant = async (request, response) => {
  const docReference =doc(db, "Restaurants", request.params.restaurantId);
  getDoc(docReference)
  .then(async (doc) => {
    if (!doc.exists()) {
      return response.status(404).json({
        message: "No se encontró el restaurante.",
      });
    }

    // Deactivate restaurant
    await updateDoc(docReference, {
      active: false
    })

    //
    return response.json({ message: "Restaurante desactivado." });
  }).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al desactivar el restaurante.',
    });
  });
};

// DEALS CRUD
const createDealObject = async (
  startDate, 
  expiryDate, 
  useMax, 
  dealType = 1,
  isRecurrent = false,
  recurrenceSchedules = [],
  userId,
  restaurantId,
  discount = 0,
  includeDrinks = false,
  terms = "",
  promotionDetails = ""
) => {
  // Get restaurant
  let restaurant = await getDoc(doc(db, "Restaurants", restaurantId))
    .catch((err) => {
      console.log(err)
      throw new Error("Error al obtener el restaurante.");
    });

  // No restaurant found.
  if(!restaurant.exists()) {
    throw new Error("No se encontró el restaurante.");
  }

  // Define expiry date settings
  const createdAt = dayjs();

  // Define start and expiry dates
  let expiryTimeParts = dayjs(expiryDate).isValid()
    ? dayjs(expiryDate)
    : createdAt.add(DEAL_EXPIRY_DEFAULT_OFFSET_HOURS, "hour");
  const expiresAt = expiryTimeParts;

  let startTimeParts = dayjs(startDate).isValid()
    ? dayjs(startDate)
    : createdAt;
  const startsAt = startTimeParts;

  // Recurrence
  const recurrenceType = isRecurrent
    ? DEAL_FREQUENCY_TYPE.RECURRENT 
    : DEAL_FREQUENCY_TYPE.SINGLE_DATE;

  // Create deal.
  let newDealItem = {
    userId: userId,
    restaurantId: restaurantId,
    dealType: dealType,
    isRecurrent: isRecurrent,
    recurrenceType: recurrenceType,
    recurrenceSchedules: recurrenceSchedules.map(schedule => {
      return {
        ...schedule,
        startsAt: dayjs(schedule.startsAt).toDate(),
        expiresAt: dayjs(schedule.expiresAt).toDate()
      }
    }) || [],
    details: promotionDetails,
    discount: discount,
    createdAt: dayjs(createdAt).toDate(),
    startsAt: dayjs(startsAt).toDate(),
    expiresAt: dayjs(expiresAt).toDate(),
    include_drinks: includeDrinks,
    useCount: 0,
    useMax: useMax,
    active: true,
    terms: terms
  };

  return newDealItem;
}
exports.createDealObject = createDealObject;
const createNewDeal = async (
  startDate, 
  expiryDate, 
  useMax, 
  dealType = 1,
  isRecurrent = false,
  recurrenceSchedules = [],
  userId,
  restaurantId,
  discount = 0,
  includeDrinks = false,
  terms = "",
  promotionDetails = ""
) => {
  const newDealItem = await createDealObject(
    startDate, 
    expiryDate, 
    useMax, 
    dealType,
    isRecurrent,
    recurrenceSchedules,
    userId,
    restaurantId,
    discount,
    includeDrinks,
    terms,
    promotionDetails,
  )

  // Create deal in the DB.
  let newDeal = await addDoc(collection(db, "Deals"), newDealItem).catch(
    (err) => {
      console.error(err);
      throw new Error("Error al crear la oferta.");
    }
  );

  // Return new documento in response.
  newDeal = await getDoc(newDeal);
  const formattedDeal = await getFormattedDeal(newDeal);
  return formattedDeal;
}
exports.createNewDeal = createNewDeal;
exports.createDeal = async (request, response) => {
  const isRecurrent = request.body.isRecurrent != undefined 
    ? Boolean(request.body.isRecurrent) 
    : false;

  //
  const newDeal = await createNewDeal(
    request.body.startsAt,
    request.body.expiresAt, 
    Number(request.body.useMax),
    request.body.dealType,
    isRecurrent,
    request.body.recurrenceSchedules,
    request.user.uid,
    request.params.restaurantId,
    Number(request.body.discount),
    request.body.include_drinks,
    request.body.terms,
    request.body.details
  ).catch(err => {
    console.log(err);
    return response.status(500).json({
      message: err.message,
    });
  });

  // Return new deal
  return response.json(newDeal);
};

const getDatesInRange = (startDate, endDate) => {
  const dateArray = [];
  let currentDate = dayjs(startDate);
  let stopDate = dayjs(endDate);

  //
  if(stopDate.diff(currentDate, 'day') > 0){
    while (stopDate.diff(currentDate, 'day') > 0) {
      dateArray.push(currentDate)
      currentDate = dayjs(currentDate).add(1, 'day');
    }
    return dateArray;
  }
  
  //
  dateArray.push(currentDate);
  return [startDate];
}
const findNextDateByWeekday = (targetWeekday, date) => {
  const targetDate = date || dayjs();
  
  // If targetDate is the same weekday as targetWeekday,
  // return current date object.
  if(targetDate.format('dddd').toLowerCase() == targetWeekday.toLowerCase()){
    return targetDate;
  }

  // Recursively call self function until finding target weekday,
  // by adding one day to the targetDate
  return findNextDateByWeekday(
    targetWeekday, 
    targetDate.add(1, 'd')
  );
}
const getNextValidSchedules = (startsAt, expiresAt) => {
  const now = dayjs();

  // If current date is after the start date,
  if(!now.isBetween(startsAt, expiresAt) && now.isAfter(startsAt)){
    const validityWindowInMinutes = expiresAt.diff(startsAt, 'minute');
    const nextValidStartDate = findNextDateByWeekday(startsAt.format('dddd'), startsAt)
      .hour(startsAt.hour())
      .minute(startsAt.minute())
      .second(startsAt.second());
    const nextValidExpiryDate = dayjs(nextValidStartDate).add(validityWindowInMinutes, 'minute');

    //
    if(!nextValidExpiryDate.isAfter(now)) {
      const newStartDate = nextValidStartDate.add(1, 'w');
      const newExpiryDate = dayjs(newStartDate).add(validityWindowInMinutes, 'minute');
      return getNextValidSchedules(
        newStartDate, 
        newExpiryDate
      );
    }

    return {
      nextValidStartDate,
      nextValidExpiryDate
    }
  }
  
  //
  return {
    nextValidStartDate: startsAt,
    nextValidExpiryDate: expiresAt
  }
} 
const getDealRedemptions = async (deal) => {
  // Get Redemptions
  const dealRedemptions = await getDocs(query(
    collection(db, "DealRedemptions"),
    where("dealId", "==", deal.id),
    orderBy("createdAt", "desc"),
  )).catch((err) => {
    console.log(err)
    throw new Error("Error al obtener las redenciones.");
  });

  // Early return if no redemptions found.
  if(dealRedemptions.size < 1){
    return [];
  }

  return dealRedemptions.docs;
}
exports.getNextValidSchedules = getNextValidSchedules;
const getFormattedDeal = async (deal) => {
  
  // Get deal's restaurant
  const restaurant = await getDoc(
    doc(db, `Restaurants/${deal.get("restaurantId")}`)
  ).catch(() => {
    throw new Error("No se encontró el restaurante.");
  });

  // Deal's validity dates
  let startsAt = dayjs(deal.get("startsAt").toDate());
  let expiresAt = dayjs(deal.get("expiresAt").toDate());
  let recurrenceSchedules = deal.data()?.recurrenceSchedules || [];
  recurrenceSchedules = recurrenceSchedules.map((schedule) => {
    return {
      ...schedule,
      startsAt: dayjs(schedule.startsAt).toDate(),
      expiresAt: dayjs(schedule.expiresAt).toDate(),
    }
  });

  // Check recurrent deal's validity dates
  if (deal.get("recurrenceType") === DEAL_FREQUENCY_TYPE.RECURRENT) {
    recurrenceSchedules = recurrenceSchedules.map((schedule) => {
      // Get next valid dates
      const newSchedules = getNextValidSchedules(startsAt, expiresAt);
      startsAt = newSchedules.nextValidStartDate;
      expiresAt = newSchedules.nextValidExpiryDate;
      // console.log("> ",  deal.id, startsAt.format('YYYY-MM-DD HH:mm:ss'), expiresAt.format('YYYY-MM-DD HH:mm:ss'))
      
      // Return the current schedule.
      return {
        ...schedule,
        startsAt: startsAt.toDate(),
        expiresAt: expiresAt.toDate(),
      };
    })
  }

  // Return deals
  return {
    ...deal.data(),
    restaurant: restaurant.get("name"),
    id: deal.id,
    recurrenceSchedules,
    startsAt,
    expiresAt,
    createdAt: deal.data().createdAt.toDate(),
  };
}
exports.getFormattedDeal = getFormattedDeal;
const getDealsList = async (restaurantId, queryParams = {}) => {
  // Build query
  const filtersList = [where("restaurantId", "==", restaurantId)];

  // Filter by 'active' state (true by default)
  const isFilterActiveSet = queryParams?.active !== undefined;
  let filterByActive =
    isFilterActiveSet && queryParams?.active == "false" ? false : true;
  if (isFilterActiveSet) {
    filtersList.push(where("active", "==", filterByActive));
  }

  // Filter by 'recurrenceType'
  let filterByRecurrenceType = queryParams?.recurrence;
  if (filterByRecurrenceType) {
    switch (filterByRecurrenceType) {
      case DEAL_FREQUENCY_TYPE.SINGLE_DATE:
        // filtersList.push(where("recurrenceType", "==", DEAL_FREQUENCY_TYPE.SINGLE_DATE));
        filtersList.push(where("recurrenceType", "!=", DEAL_FREQUENCY_TYPE.RECURRENT));
        break;
      case DEAL_FREQUENCY_TYPE.RECURRENT:
        filtersList.push(where("recurrenceType", "==", DEAL_FREQUENCY_TYPE.RECURRENT));
        break;
    }
  }

  // Filter by date range
  let range_init = queryParams?.range_init;
  if (range_init && range_init != "") {
    if (dayjs(range_init).isValid()) {
      range_init = dayjs(dayjs(range_init).toISOString()).toDate();
      filtersList.push(
        where("startsAt", ">=", Timestamp.fromDate(range_init))
      );
    }
  }
  let range_end = queryParams?.range_end;
  if (range_end && range_end != "") {
    if (dayjs(range_end).isValid()) {
      range_end = dayjs(range_end).hour(23).minute(59).second(59).toDate();
      filtersList.push(where("startsAt", "<=", Timestamp.fromDate(range_end)));
    }
  }

  // Order params
  const orderField = queryParams?.order || "startsAt";
  const orderSort = queryParams?.sort || "asc";

  // Get collection
  let collectionQuery = query(
    collection(db, `Deals`),
    ...filtersList,
    orderBy(orderField, orderSort),
    limit(queryParams?.limit || LISTING_CONFIG.MAX_LIMIT)
  )
  const dealsList = await getDocs(collectionQuery)
  .catch((err) => {
    console.log(err)
    throw new Error("Error al obtener las ofertas.");
  });

  // Early return if no deals found
  if (!dealsList.size) {
    return [];
  }

  // Format deals
  let deals = [];
  for (const deal of dealsList.docs) {
    // Filter Out Deals that are not valid
    if (!isDealValid(deal.data())) {
      continue;
    }

    // Filter out deals that are not active
    if (filterByActive && !isDealActive(deal.data())) {
      continue;
    }

    // If validOn filter is set, 
    // Search for weekday on recurrenceSchedules
    if(queryParams.validOn){
      const weekDays = queryParams.validOn;

      if(isDealRecurrent(deal.data())){
        const isValidOnWeekday = deal.data().recurrenceSchedules.find(schedule => { 
          return weekDays.find(day => schedule.daySlug == day.toLocaleLowerCase())
        });
      
        if (!isValidOnWeekday) {
          continue;
        }
      }
    }

    //
    const formattedDeal = await getFormattedDeal(deal)
    .catch((err) => {
      console.log(err)
      throw new Error("Error al obtener las ofertas.");
    });

    // Return deals
    deals.push(formattedDeal);
  }

  // Return deals
  return deals;
}
exports.getDealsList = getDealsList;
const syncRestaurantActiveDealsList = async (restaurantId, deal = {}) => {
  const { adminDb } = require("../utils/admin");
  const restaurantRef = adminDb.doc(`Restaurants/${restaurantId}`)

  // Update restaurant deals
  //const restaurantRef = doc(db, `Restaurants/${restaurantId}`);
  // const restaurant = await restaurantRef
  //   .get()
  //   .catch((err) => {
  //     console.log(err)
  //     throw new Error("Error al obtener el restaurante.");
  //   });

  // Get active deals list
  let dealsList = await getDealsList(restaurantId, {active: true})
    .catch(() => {
      throw new Error("Error al obtener la lista de ofertas.");
    });
  

  // Format deals dates
  dealsList = dealsList.map(deal => {
    let {recurrenceSchedules } = deal;
    const expiresAt = dayjs(deal.expiresAt).toDate();
    const createdAt = dayjs(deal.createdAt).toDate();
    const startsAt = dayjs(deal.startsAt).toDate();

    recurrenceSchedules = recurrenceSchedules.map(schedule => {
        return {
          ...schedule,
          startsAt,
          expiresAt,
        }
      })

    return {
      ...deal,
      recurrenceSchedules,
      expiresAt,
      createdAt,
      startsAt
    }
  });

  // Update restaurant deals
  await adminDb.doc(`Restaurants/${restaurantId}`).update({
    deals: dealsList
  }).catch((err) => {
    console.log(err)
    throw new Error("Error al actualizar las ofertas del restaurante.");
  });

  // Return deals
  console.log('Finished synchronizing active deals to restaurant.')
  return dealsList;
}
exports.syncRestaurantActiveDealsList = syncRestaurantActiveDealsList;

exports.getDeals = async (request, response) => {
  let dealsList = await getDealsList(request.params.restaurantId, request.query)
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
      });
    });

  // Early return if no deals found
  if (!dealsList.length) {
    return response.json([]);
  }

  // Get reservation count
  const dealsWithRedepmtionCount = [];
  for(const deal of dealsList){
    dealsWithRedepmtionCount.push({
      ...deal,
      redemptionsCount: await getDealRedemptions(deal).length
    });
  }

  // Return deals
  return response.json(dealsWithRedepmtionCount);
};
exports.getDeal = async (request, response) => {
  const docSnap = await getDoc(doc(db, `Deals/${request.params.dealId}`)).catch(
    (err) => {
      return response.status(500).json({
        ...err,
        message: "Error al obtener la oferta.",
      });
    }
  );

  // Early return if no deal found
  if (!docSnap.exists()) {
    return response.status(204).json({
      message: "No se encontró la oferta.",
    });
  }
    
  // Filter Out Deals that are not valid
  if (!isDealValid(docSnap.data())) {
    return response.status(204).json({
      message: "No se encontró la oferta.",
    });
  }
  const formattedDeal = await getFormattedDeal(docSnap);
  return response.json(formattedDeal);
};
exports.updateDeal = async (request, response) => {
  // Get deal
  const docRef = doc(db, `Deals/${request.params.dealId}`);
  let deal = await getDoc(docRef).catch((err) => {
    console.log(err);
    return response.status(500).json({
      ...err,
      message: "Error al obtener la oferta.",
    });
  });

  // Early return if no deal found
  if (!deal.exists()) {
    return response.status(400).json({
      message: "No se encontró la oferta.",
    });
  }

  // Form new deal object
  const updateObject = {
    id: deal.id,
    ...deal.data(),
    ...request.body,
    createdAt: deal.get("createdAt"),
    startsAt: request.body.startsAt ? Timestamp.fromDate(new Date(request.body.startsAt)) : deal.get("startsAt"),
    expiresAt: request.body.expiresAt ? Timestamp.fromDate(new Date(request.body.expiresAt)) : deal.get("expiresAt"),
  };

  // Update record
  await updateDoc(docRef, updateObject)
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        message: "Error al actualizar la oferta.",
      });
    });
  
  // Return updated deal
  deal = await getDoc(docRef);
  const formattedDeal = await getFormattedDeal(deal);
  response.json(formattedDeal);
};
exports.deleteDeal = async (request, response) => {
  const docRef = doc(db, `Deals/${request.params.dealId}`);

  // Verify that document exists
  const deal = await getDoc(docRef);
  if (!deal.exists()) {
    return response.status(404).json({
      message: "No se encontró la oferta.",
    });
  }

  // Deactive deal in the db
  await updateDoc(docRef, {
    active: false,
  }).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "No se pudo desactivar la oferta.",
    });
  });
  // await deleteDoc(docRef).catch((err) => {
  //   return response.status(500).json({
  //     message: err.code,
  //   });
  // });

  // Response
  return response.json({
    message: "Oferta cancelada.",
  });
};
exports.getUniqueDealsByRedemptions = async (request, response) => {
  let dealsList = await getDealsList(request.params.restaurantId, request.query)
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
      });
    });

  // Early return if no deals found
  if (!dealsList.length) {
    return response.json([]);
  }

  // Get reservation count
  const dealsWithRedepmtionCount = [];
  for(const deal of dealsList){
    console.log('deal')
    dealsWithRedepmtionCount.push({
      ...deal,
      redemptionsCount: await getDealRedemptions(deal).length
    });
  }

  // Return deals
  return response.json(dealsWithRedepmtionCount);
}

// RESERVATIONS CRUD
const getFormattedReservation = async (document) => {
  const reservation = document.data();

  // Get reservation's restaurant
  let restaurantName = "Restaurante no encontrado.";
  const restaurant = await getDoc(
    doc(db, `Restaurants/${reservation.restaurantId}`)
  ).catch(() => {
    throw new Error("No se encontró el restaurante.");
  });
  if(restaurant.exists()){
    restaurantName = restaurant.get("name");
  }

  // Get related deal
  const dealReference = doc(db, "Deals", reservation.dealId);
  const deal = await getDoc(dealReference).catch((err) => {
    throw new CustomError({
      ...err,
      status: 400, 
      message: "Error al obtener la oferta.",
    });
  });

  // Confirm that the reservation is linked to a deal
  let dealDetails = 'Oferta no encontrada.';
  let dealType = 'N/A';
  let dealTerms = '';
  if (deal.exists()) {
    // Determine status description
    switch (deal.data().dealType) {
      case DEAL_TYPE.PROMOTION:
        dealDetails = deal.data().details
          ? `${deal.data()?.details}.`
          : "";
        break;
      case DEAL_TYPE.DISCOUNT:
      default:
        dealDetails = `${deal.data().discount * 100}% de descuento.`;
    }

    //
    dealType = deal.data().dealType;
    dealTerms = deal.data().terms ? deal.data().terms : "";
  }

  // Get Customer from Firestore
  let customer = await getDoc(
    doc(db, "Users", reservation.customerId)
  ).catch((err) => {
    throw new CustomError({
      ...err,
      status: 400, 
      message: "Error al obtener el usuario.",
    });
  });
  let customerEmail = "Email no encontrado";
  let customerName = "Usuario no encontrado";
  if (customer.exists()) {
    customerName = customer.data().email || customerEmail;
    customerEmail = ( customer.data().firstName || "" ) + " " + ( customer.data().lastName || "" );
  } else {
    // If user was not found, try to get it from Firebase Auth
    customer = await adminAuth.getUser(reservation.customerId)
      .catch((err) => {
        console.log(err.errorInfo)
      });
    if (customer) {
      customerName = customer.email || customerEmail;
      customerEmail = customer.displayName || customerName;
    }
  }

  // Determine status description
  let statusDescription = getReservationStatusDetails(reservation.status);

  // Return formatted reservation.
  return {
    id: document.id,
    ...reservation,
    restaurant: restaurantName,
    statusDescription,
    checkIn: reservation.checkIn
      ? reservation.checkIn.toDate()
      : null,
    cancelledAt: reservation.cancelledAt
      ? reservation.cancelledAt.toDate()
      : null,
    createdAt: reservation.createdAt.toDate(),
    reservationDate: reservation.reservationDate.toDate(),
    reminderNotificationSentAt: reservation.reminderNotificationSentAt 
      ? reservation.reminderNotificationSentAt.toDate() 
      : null,
      reminderNotificationSent: reservation.reminderNotificationSent,
    dealType,
    dealDetails,
    dealTerms,
    customer: customerName,
    customerEmail: customerEmail,
  };
}
exports.getFormattedReservation = getFormattedReservation;
const getReservations = async (restaurantId, queryProps) => {
  const filtersList = [where("restaurantId", "==", restaurantId)];
  const queryParams = {
    ...queryProps
  }

  // Filter by 'active' if param is defined by user.
  if (queryParams.active && queryParams.active != "") {
    let filterByActive =
      queryParams?.active && queryParams?.active == "false" ? false : true;
    filtersList.push(where("active", "==", filterByActive));
  }

  // Filter by date range
  let range_init = queryParams.range_init;
  if (range_init && range_init != "") {
    if (dayjs(queryParams.range_init).isValid()) {
      range_init = dayjs(dayjs(queryParams.range_init).toISOString())
        .toDate();

      filtersList.push(
        where("reservationDate", ">=", Timestamp.fromDate(range_init))
      );
    }
  }
  let range_end = queryParams.range_end;
  if (range_end && range_end != "") {
    if (dayjs(queryParams.range_end).isValid()) {
      range_end = dayjs(queryParams.range_end)
        .hour(23)
        .minute(59)
        .second(59)
        .toDate();

      filtersList.push(
        where("reservationDate", "<=", Timestamp.fromDate(range_end))
      );
    }
  }

  // Filtery by status
  let statusCode = undefined;
  let status = queryParams?.status || undefined;
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

  // Get Deals results
  let collectionQuery = query(
    collection(db, `Reservations`),
    ...filtersList,
    orderBy("reservationDate", "desc")
  );
  const reservations = await getDocs(collectionQuery).catch((err) => {
    throw new CustomError({
      ...err,
      status: 400, 
      message: "Error al obtener las reservaciones.",
    });
  });

  // Return results
  if (reservations.size > 0) {
    // Validate and format reservations before returning them
    let reservationsResults = [];
    for (let document of reservations.docs) {
      const reservation = document.data();

      // Get Deal
      const dealReference = doc(db, "Deals", reservation.dealId);
      const deal = await getDoc(dealReference).catch((err) => {
        throw new CustomError({
          ...err,
          status: 400, 
          message: "Error al obtener la oferta.",
        });
      });

      // Confirm that the reservation is linked to a deal
      if (!deal.exists()) {
        continue;
      }

      // Determine status description
      let dealDetails;
      switch (deal.data().dealType) {
        case DEAL_TYPE.PROMOTION:
          dealDetails = deal.data().details
            ? `${deal.data()?.details}.`
            : "";
          break;
        case DEAL_TYPE.DISCOUNT:
        default:
          dealDetails = `${deal.data().discount * 100}% de descuento.`;
      }

      // Get Customer from Firestore
      let customer = await getDoc(
        doc(db, "Users", reservation.customerId)
      ).catch((err) => {
        throw new CustomError({
          ...err,
          status: 400, 
          message: "Error al obtener el usuario.",
        });
      });
      let customerEmail = "Usuario no encontrado";
      if (customer.exists()) {
        customerEmail = ( customer.data().firstName || "" ) + " " + ( customer.data().lastName || "" );
      } else {
        // If user was not found, try to get it from Firebase Auth
        customer = await adminAuth.getUser(reservation.customerId)
          .catch((err) => {
            console.log(err)
          });
        if (customer) {
          customerEmail = customer.displayName || "Usuario sin nombre";
        }
      }

      // Determine status description
      let statusDescription = getReservationStatusDetails(reservation.status);

      // Format and add reservation to the list
      reservationsResults.push({
        id: document.id,
        ...reservation,
        statusDescription,
        checkIn: reservation.checkIn
          ? reservation.checkIn.toDate()
          : null,
        cancelledAt: reservation.cancelledAt
          ? reservation.cancelledAt.toDate()
          : null,
        createdAt: reservation.createdAt.toDate(),
        reservationDate: reservation.reservationDate.toDate(),
        dealType: deal.data().dealType,
        dealDetails,
        dealTerms: deal.data().terms ? deal.data().terms : "",
        customer: customerEmail,
      });
    }

    //
    return reservationsResults
  } 
  
  // Return empty list
  return []
}
exports.getReservationsList = async (request, response) => {
  const reservations = await getReservations(request.params.restaurantId, request.query)
  .catch((err) => {
    return response.status(400).json({
      ...err,
      message: err.message
    });
  });

  // Response
  if (reservations.length > 0) {
    return response.json(reservations);
  }

  // Return empty list
  return response.status(200).json([]);
};

// CATEGORIES CRUD
exports.createCategory = (request, response) => {
  let newCategoryItem = {
    active: true,
    createdAt: new Date().toISOString(),
    description: request.body.description || "",
    thumbnail: request.body.thumbnail || "",
    name: request.body.name || "",
    slug: slugifyString(request.body.name) || "",
  };

  // Insert Category
  const categoriesCollection = collection(db, "Categories");
  addDoc(categoriesCollection, newCategoryItem)
    .then((documentRef) => {
      return response.json({
        id: documentRef.id,
        ...newCategoryItem,
      });
    })
    .catch((err) => {
      console.error(err);
      return response
        .status(500)
        .json({ ...err, message: "Error al agregar la categoría." });
    });
};
exports.getCategories = async (request, response) => {
  // Get Deals collection
  const dealsQuery = query(collection(`Categories`));
  const deals = await getDocs(dealsQuery).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener las categorías.",
    });
  });

  // Response
  if (deals.size > 0) {
    let categories = [];
    deals.forEach((doc) => {
      categories.push({
        ...doc.data(),
        id: doc.id,
      });
    });
    return response.json(categories);
  } else {
    return response.status(204).json({
      message: "No se encontraron categorías.",
    });
  }
};

// Get Menus
exports.getRestaurantMenus = async (request, response) => {
  // Get Menus collection
  const menus = await getDocs(
    query(
      collection(db, `RestaurantMenus`),
      where("restaurantId", "==", request.params.restaurantId)
    )
  ).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener los menús.",
    });
  });

  // Response
  if (menus.size > 0) {
    let menus = [];
    menus.forEach((doc) => {
      menus.push({
        ...doc.data(),
        id: doc.id,
      });
    });
    return response.json(menus);
  } else {
    return response.status(200).json([]);
  }
};
// Post Menus
exports.postRestaurantMenu = async (request, response) => {
  // Get restaurant document
  const restaurantDocRef = doc(db, `/Restaurants/`, request.params.restaurantId);
  const restaurantDocument = (await getDoc(restaurantDocRef)).data();

  // Get Menus
  const menusCollectionRef = query(
    collection(db, `RestaurantMenus`),
    where("restaurantId", "==", request.params.restaurantId),
    where("active", "==", true)
  );
  const menusCollection = await getDocs(menusCollectionRef).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener los menús.",
    });
  });
  // Validate maximum of items
  if (menusCollection.size >= 10) {
    return response
      .status(400)
      .json({ message: "Alcanzaste el límite de menús [10]." });
  }

  // Image config
  const BB = busboy({ headers: request.headers });
  let imageFileName;
  let imageToBeUploaded = {};

  //
  BB.on("file", (name, file, info) => {
    const { filename, encoding, mimeType } = info;

    // Validate file format
    if (
      mimeType !== "application/pdf" &&
      mimeType !== "image/png" &&
      mimeType !== "image/jpeg" &&
      mimeType !== "image/jpg"
    ) {
      return response
        .status(400)
        .json({ message: "Formato del menú inválido." });
    }

    // Name file
    const imageExtension = filename.split(".")[filename.split(".").length - 1];
    imageFileName = `${new Date().toISOString()}.${imageExtension}`;
    const filePath = path.join(os.tmpdir(), imageFileName);
    imageToBeUploaded = { filePath, mimeType, imageFileName };
    file.pipe(fs.createWriteStream(filePath));
  });

  // Delete current image if exists
  deleteImage(imageFileName);

  // When finishing upload, store file on Firebase
  BB.on("finish", async () => {
    const bucket = admin.storage().bucket();
    const destination = `Restaurants/${restaurantDocument.slug}/Menus/${imageToBeUploaded.imageFileName}`;
    await bucket
      .upload(imageToBeUploaded.filePath, {
        resumable: false,
        public: true,
        destination,
        metadata: {
          metadata: {
            contentType: imageToBeUploaded.mimetype,
          },
        },
      })
      .catch((err) => {
        console.error(err);
        return response
          .status(500)
          .json({ ...err, message: "Error al subir el menú." });
      });

    // Create new registry
    const file = await bucket.file(destination);
    const fileURL = await file.publicUrl();
    const newMenu = {
      restaurantId: restaurantDocument.id,
      active: true,
      createdAt: new Date().toISOString(),
      file: fileURL,
      thumbnail: "",
    };
    await addDoc(collection(db, `RestaurantMenus`), newMenu);

    // Response
    const menusList = [];
    (await menusCollectionRef.get()).forEach((item) => {
      menusList.push({ ...item.data(), id: item.id });
    });
    return response.json(menusList);
  });
  BB.end(request.rawBody);
};

// Get Gallery
exports.getRestaurantGallery = async (request, response) => {
  // Get Photos collection
  const collection = await getDocs(
    query(
      collection(`RestaurantPhotos`),
      where("restaurantId", "==", request.params.restaurantId)
    )
  ).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener las fotografías.",
    });
  });

  // Response
  if (collection.size > 0) {
    let photos = [];
    collection.forEach((doc) => {
      photos.push({
        ...doc.data(),
        id: doc.id,
      });
    });
    return response.json(photos);
  } else {
    return response.status(200).json([]);
  }
};
// Delete photo
const deleteImage = (imageName) => {
  const bucket = admin.storage().bucket();
  const path = `${imageName}`;
  return bucket
    .file(path)
    .delete()
    .then(() => {
      return;
    })
    .catch((error) => {
      return;
    });
};
// Upload profile picture
exports.uploadRestaurantProfilePhoto = async (request, response) => {
  console.log('image method')
  // Get restaurant document
  const restaurantDocRef = doc(db, `/Restaurants/${request.params.restaurantId}`);
  const getRestaurant = async (restaurantId) => {
    const restaurantDocRef = doc(db, `/Restaurants/${restaurantId}`);
    let restaurantDocument = await getDoc(restaurantDocRef);
    if (!restaurantDocument.exists()) {
      throw new Error("Restaurante no encontrado");
    }
    return restaurantDocument;
  };
  let resturantRef = await getRestaurant(request.params.restaurantId).catch(
    (err) => {
      response
        .status(404)
        .json({ ...err, message: "Error al obtener el restaurante." });
    }
  );
  let restaurantDocument = resturantRef.data();

  // BusBoy
  const bb = busboy({ headers: request.headers });

  // Define array of file write streams
  const fileWrites = [];
  console.log('before busboy')
  //
  bb.on("file", (name, file, info) => {
    // upload image
    const image = uploadFiletoBucket(
      file,
      info,
      `Restaurants/${restaurantDocument.slug}/Photos`
    )
      .then(async (fileURLs) => {
        console.log("fileURLs", fileURLs);
        for (const image of fileURLs) {
          switch (image.keyName) {
            case "avatar":
              await updateDoc(restaurantDocRef, {
                avatar: image.fileURL,
              });
              break;
            case "photo":
              await updateDoc(restaurantDocRef, {
                photo: image.fileURL,
              });
              break;
            case "cover":
              await updateDoc(restaurantDocRef, {
                cover: image.fileURL,
              });
              break;
          }
        }
      })
      .catch((err) => {
        console.error("err ", err);
        throw new Error(err);
      });

    // add write stream to array
    fileWrites.push(image);
  });

  bb.on("error", (err) => {
    console.log("Busboy error >>>>:", err);
    functions.logger.error("Busboy error >>>>:", err);
  });

  bb.on("finish", async () => {
    console.log("Busboy finish >>>>:");
    await Promise.all(fileWrites).catch((err) => {
      console.error("err ", err);
    });

    // Response
    restaurantDocument = (await getDoc(restaurantDocRef)).data();
    response.json(restaurantDocument);
  });

  //
  bb.end(request.rawBody);
};

// Get Balance
exports.getPartnerCurrentBalance = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;

  // Filter by date range
  let range_init = dayjs().startOf('month').toDate();
  if (billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    range_init = dayjs(billingPeriodStart).toDate();
  }
  let range_end = dayjs().endOf('month').toDate();
  if (billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    range_end = dayjs(billingPeriodEnd).toDate();
  }

  // Get Deal Redemptions
  const dealRedemptions = await getDocs(query(
    collection(db, `DealRedemptions`),
    where("restaurantId", "==", restaurantId),
    where("createdAt", ">=", range_init),
    where("createdAt", "<=", range_end),
  )).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener las redenciones de la oferta.",
      });
  });

  // Calulate balance
  let balanceCalc = 0;
  for(const redemption of dealRedemptions.docs) {
    const averageTicket = redemption.data().averageTicket ? parseFloat(redemption.data().averageTicket) : 0;
    const takeRate = redemption.data().takeRate ? parseFloat(redemption.data().takeRate) : DEFAULT_TAKE_RATE;
    balanceCalc += averageTicket * takeRate;
  }

  // Response
  return response.json({
    balance: balanceCalc,
    redemptionsCount: dealRedemptions.size,
    redemptions: dealRedemptions.docs.map((doc) => {
      return {
        ...doc.data(),
        createdAt: doc.data().createdAt.toDate(),
        id: doc.id,
      };
    })
  });
}
exports.getPartnerBalanceHistory = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;

  // Filter by date range
  let range_init = dayjs().startOf('month').toDate();
  if (billingPeriodStart && dayjs(billingPeriodStart).isValid()) {
    range_init = dayjs(billingPeriodStart).toDate();
  }
  let range_end = dayjs().endOf('month').toDate();
  if (billingPeriodEnd && dayjs(billingPeriodEnd).isValid()) {
    range_end = dayjs(billingPeriodEnd).toDate();
  }

  // Get Deal Redemptions
  const billings = await getDocs(query(
    collection(db, `Billings`),
    where("restaurantId", "==", restaurantId),
    where("periodStart", ">=", range_init),
    where("isPaid", "==", false),
  )).catch((err) => {
    console.log(err)
    return response.status(500).json({
      ...err,
      message: "Error al obtener el periodo de la facturación.",
      });
  });

  // Calulate balance
  let balanceCalc = 0;
  let pendingBillings = [];
  let pendingRedemptions = [];
  for(const billing of billings.docs) {
    const billingData = billing.data();

    // Limit billings to range
    const billingPeriodEnd = dayjs(billingData.periodEnd.toDate());
    if(billingPeriodEnd.isAfter(dayjs(range_end))){
      continue; 
    }

    // Calculate balance
    balanceCalc += billingData?.debtQuantity || 0;
    pendingBillings = [
      ...pendingBillings, 
      {
        ...billingData,
        periodStart: billingData.periodStart?.toDate(),
        periodEnd: billingData.periodEnd?.toDate(),
        createdAt: billingData.createdAt?.toDate(),
        updatedAt: billingData.updatedAt?.toDate(),
        paidAt: billingData.paidAt?.toDate(),
      }
    ];
    pendingRedemptions = [...pendingRedemptions, ...billingData.redemptions];
  }

  // Response
  return response.json({
    balance: balanceCalc,
    pendingBillings,
    pendingRedemptions
  });
}
exports.getPartnerBillings = async (request, response) => {
  const restaurantId = request.params.restaurantId;
  const billingPeriodStart = request.query.periodStart;
  const billingPeriodEnd = request.query.periodEnd;
  
  // Filter by date range
  let range_init = dayjs().set('month', 0).set('date', 1).set('year', 2022).toDate();
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

  console.log(range_init, range_end)

  // Get restaurant
  const restaurantDoc = doc(db, "Restaurants", restaurantId);
  const restaurant = await getDoc(restaurantDoc).catch((err) => {
    return response.status(404).json({ message: "Restaurante no encontrado." });
  });

  // Get Billings
  const billingsQuery = query(
    collection(db, "Billings"), 
    where("restaurantId", "==", restaurant.id),
    where("createdAt", ">=", range_init),
    where("createdAt", "<=", range_end),
    orderBy("createdAt", "desc"),
    orderBy("periodStart", "desc")
  );
  const billings = await getDocs(billingsQuery).catch((err) => {
    console.log(err)
    return response.status(500).json({ message: "Error al obtener las facturaciones." });
  });

  // Early return if empty results
  if(!billings.size){
    return response.status(200).json([]);
  }

  // Return
  return response.json(billings.docs.map((billing) => {
    return {
      id: billing.id,
      ...billing.data(),
      createdAt: billing.data().createdAt.toDate(),
      updatedAt: billing.data().updatedAt.toDate(),
      periodStart: billing.data().periodStart.toDate(),
      periodEnd: billing.data().periodEnd.toDate(),
      paidAt: billing.data().paidAt ? billing.data().paidAt.toDate() : null,
    }
  }));
}

//////////
exports.importRestaurants = async (request, response) => {
  // File path.
  readXlsxFile("Restaurants-List-Mockup.xlsx", { sheet: 2 }).then((rows) => {
    let index = 0;

    // Loop through rows
    for (const restaurant of rows) {
      if (index != 0) {
        let categories = restaurant[6].split(",");
        categories = categories.map((cat, index) => {
          return {
            id: "",
            name: cat,
            slug: slugifyString(cat),
          };
        });
        let location = restaurant[8].split(", ");
        location = {
          latitude: Number(location[0]),
          longitude: Number(location[1]),
        };

        // Create restaurant.
        const newRestaurantItem = getNewRestaurantObject(
          restaurant[0], 
          '',
          '',
          {
            description: restaurant[1],
            phone: restaurant[3],
            photo: restaurant[10],
            avatar: restaurant[9],
            rating: restaurant[5],
            website: restaurant[4],
            address: restaurant[7],
            categories,
            location: {
              ...location,
            }
          }
        );

        // Index in Algolia
        // algoliaIndex.saveObject(newRestaurantItem,
        //   { autoGenerateObjectIDIfNotExist: true }
        // );

        //
        // Create restaurant.
        addDoc(collection(db, "Restaurants"), newRestaurantItem)
          .then((documentRef) => {
            // Get new document
            getDoc(documentRef).then(async (documentSnapshot) => {
              const publicUrl = await generateQR(
                documentRef.id,
                `Restaurants/${documentSnapshot.data().slug}/qr_${
                  documentRef.id
                }-${new Date().getTime()}.png`
              );

              // register QR URL to database
              await updateDoc(documentRef, {
                qrCode: publicUrl,
              });

              // return new document
              const updatedDocument = await getDoc(documentRef);
              const responseItem = {
                id: documentRef.id,
                ...updatedDocument.data(),
              };
              //   response.json(responseItem);
            });
          })
          .catch((err) => {
            console.error(err);
            return response.status(500).json({
              ...err,
              message: "Error al crear el restaurante.",
            });
          });
      }

      // increment counter
      index++;
    }
  });

  return response.json({});
};
exports.updateAllRestaurants = async (request, response) => {
  const restaurantsReference = collection(db, "Restaurants");
  const restaurants = await getDocs(query(restaurantsReference));

  if (restaurants.size) {
    for (const restaurant of restaurants.docs) {
      //const restaurantData = restaurant.data();
      await updateDoc(restaurant.ref, {
        ...request.body,
        //schedules: request.body.schedules.map(item => {return {...item, active: true }})
      }).catch((err) => {
        console.error(err);
        return response.status(500).json({
          ...err,
          message: "Error al actualizar el restaurante.",
        });
      });
    }
    return response.json({ state: "Updated restaurants successfully." });
  }

  ///
  return response.json({ state: "No restaurants found." });
};

// Verify restaurant availability
exports.isRestaurantNameAvailable = async (request, response) => {
  if (!request.params.restaurantName || request.params.restaurantName == "") {
    return response.status(400).json({
      message: "El nombre del restaurante es obligatorio.",
    });
  }

  const restaurantName = request.params.restaurantName.trim();
  const restaurantCollection = collection(db, "Restaurants");

  // Look after plain Restaurant Name.
  getDocs(query(restaurantCollection, where("name", "==", `${restaurantName}`)))
    .then(async (data) => {
      if (data.size) {
        return response.json({
          available: false,
        });
      }

      // Look after slugified Restaurant Name.
      const slugifiedDocument = await getDocs(
        query(
          restaurantCollection,
          where("slug", "==", `${slugifyString(restaurantName)}`)
        )
      );
      if (slugifiedDocument.size) {
        return response.json({
          available: false,
        });
      }

      return response.json({
        available: true,
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: "Error al obtener el restaurante.",
      });
    });
};

//
exports.createQR = async (request, response) => {
  const publicUrl = await generateQR(
    request.body.restaurantId,
    `Restaurants/${request.body.restaurantSlug}/qr_${
      request.body.restaurantId
    }-${new Date().getTime()}.png`
  );
  return response.json({ publicUrl });
};
const generateQR = async (restaurantId, path) => {
  const stg = admin.storage();

  // generate QR code
  var QRCode = require("qrcode");
  const qrCode = await QRCode.toDataURL(restaurantId, {
    scale: 20,
    color: { dark: "#E53E3A" },
  });

  // upload QR to bucket
  const metadata = {
    public: true,
    resumable: false,
    metadata: { contentType: base64MimeType(qrCode) || "" },
    validation: false,
  };

  const bucket = stg.bucket(config.storageBucket);
  const file = bucket.file(path);
  const base64EncodedString = qrCode.replace(/^data:\w+\/\w+;base64,/, "");
  const fileBuffer = Buffer.from(base64EncodedString, "base64");
  await file.save(fileBuffer, metadata);

  return file.publicUrl();
};
const base64MimeType = (encoded) => {
  var result = null;

  if (typeof encoded !== "string") {
    return result;
  }

  var mime = encoded.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/);

  if (mime && mime.length) {
    result = mime[1];
  }

  return result;
};

// UTILS
const validateName = (name) => {
  // Name validations
  if (name != undefined && name != "") {
    return true;
  }
  return false;
};
const validateAddress = (address) => {
  // Address validations
  if (address != undefined && address != "") {
    return true;
  }
  return false;
};
const validatePhone = (phone) => {
  // Phone validations
  if (phone != undefined && phone != "") {
    return true;
  }
  return false;
};

const getMissingRequirements = (restaurant) => {
  const requiredValidations = [
    {
      operation: validateAddress,
      field: "address",
      args: [restaurant.address],
      error: "Dirección obligatoria.",
    },
    {
      operation: validateName,
      field: "name",
      args: [restaurant.name],
      error: "Nombre del restaurante obligatorio.",
    },
    {
      operation: validatePhone,
      field: "phone",
      args: [restaurant.phone],
      error: "Teléfono de contacto obligatorio.",
    },
  ];

  // Execute validations and get detils on missing information
  const missingRequirements = requiredValidations.reduce(
    (requirements, validation) => {
      if (!validation.operation(...validation.args)) {
        return [
          ...requirements,
          {
            missingField: validation.field,
            message: validation.error,
          },
        ];
      }

      return requirements;
    },
    []
  );

  //
  return missingRequirements;
};
const hasMissingRequirements = (restaurant) => {
  return getMissingRequirements(restaurant).length > 0;
};
