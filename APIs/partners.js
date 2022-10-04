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
  deleteDoc,
  updateDoc,
  startAfter,
  startAt,
  endAt,
  limit,
  orderBy,
} = require("firebase/firestore");
const { db, admin, adminAuth } = require("../utils/admin");
const config = require("../utils/config");
const { slugifyString } = require("../utils/formatters");
const busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
const readXlsxFile = require("read-excel-file/node");
const dayjs = require("dayjs");
const {
  RESERVATION_STATUS,
  getReservationStatusDetails,
} = require("../utils/reservations-utils");
const {
  DEAL_EXPIRY_DEFAULT_OFFSET_HOURS,
  isDealValid,
  isDealActive,
} = require("../utils/deals-utils");
const { getNewRestaurantObject } = require("../utils/restaurant-utils");
const { uploadFiletoBucket } = require("../utils/upload-utils");
const {
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

  // Update document.
  await updateDoc(restaurantReference, {
    ...request.body,
    categories,
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
exports.createDeal = async (request, response) => {
  // Define expiry date settings
  const createdAt = dayjs();

  // Define start and expiry dates
  let expiryTimeParts = dayjs(request.body.expiresAt).isValid()
    ? dayjs(request.body.expiresAt)
    : createdAt.add(DEAL_EXPIRY_DEFAULT_OFFSET_HOURS, "hour");
  const expiresAt = expiryTimeParts;

  let startTimeParts = dayjs(request.body.startsAt).isValid()
    ? dayjs(request.body.startsAt)
    : createdAt;
  const startsAt = startTimeParts;

  // Create deal.
  let newDealItem = {
    userId: request.user.uid,
    restaurantId: request.params.restaurantId,
    dealType: Number(request.body.dealType),
    details: request.body.details ? request.body.details : "",
    discount: request.body.discount > 0 ? request.body.discount : 0,
    createdAt: new Timestamp(createdAt.unix()),
    startsAt: new Timestamp(startsAt.unix()),
    expiresAt: new Timestamp(expiresAt.unix()),
    include_drinks: request.body.include_drinks || false,
    useCount: 0,
    useMax: Number(request.body.useMax),
    active: true,
    terms: request.body.terms ? request.body.terms : "",
  };

  // Get restaurant
  let document = await getDocs(
    query(
      collection(db, "Restaurants"),
      where("userId", "==", request.user.uid)
    )
  ).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener el restaurante.",
    });
  });

  // No restaurant found.
  if (document.size < 1) {
    return response.status(204).json({
      message: "No se encontró el restaurante.",
    });
  }

  // Get latest restaurant.
  let restaurant = document.docs[document.size - 1];
  newDealItem = {
    restaurantId: restaurant.id,
    ...newDealItem,
  };

  // Create deal in the DB.
  const documentRef = await addDoc(collection(db, "Deals"), newDealItem).catch(
    (err) => {
      console.error(err);
      return response
        .status(500)
        .json({ ...err, message: "Error al crear la oferta." });
    }
  );

  // Return new documento in response.
  const doc = await getDoc(documentRef);
  return response.json({
    ...newDealItem,
    id: doc.id,
    startsAt: doc.data().startsAt.toDate(),
    expiresAt: doc.data().expiresAt.toDate(),
    createdAt: doc.data().createdAt.toDate(),
  });
};
exports.getDeals = async (request, response) => {
  // Build query
  const filtersList = [where("restaurantId", "==", request.params.restaurantId)];

  // Filter by 'active' state (true by default)
  const filterActiveIsSet = request.query?.active !== undefined;
  let filterByActive =
    filterActiveIsSet && request.query?.active == "false" ? false : true;
  if (filterActiveIsSet) {
    filtersList.push(where("active", "==", filterByActive));
  }

  // Filter by date range
  let range_init = request.query.range_init;
  if (range_init && range_init != "") {
    if (dayjs(range_init).isValid()) {
      range_init = dayjs(dayjs(range_init).toISOString()).toDate();
      filtersList.push(
        where("createdAt", ">=", Timestamp.fromDate(range_init))
      );
    }
  }
  let range_end = request.query.range_end;
  if (range_end && range_end != "") {
    if (dayjs(range_end).isValid()) {
      range_end = dayjs(range_end).hour(23).minute(59).second(59).toDate();
      filtersList.push(where("createdAt", "<=", Timestamp.fromDate(range_end)));
    }
  }

  // Get collection
  let collectionQuery = query(
    collection(db, `Deals`),
    ...filtersList,
    // orderBy(request.params.o || 'createdAt', 'desc'),
    limit(LISTING_CONFIG.MAX_LIMIT)
  );

  // Get the last visible document
  // const documentSnapshots = await getDocs(collectionQuery);
  // const lastVisible = documentSnapshots.docs[documentSnapshots.docs.length-1];

  // collectionQuery = query(
  //   collection(db, `Deals`),
  //   ...filtersList,
  //   orderBy(request.params.o || 'createdAt', 'desc'),
  //   startAt(lastVisible),
  //   limit(PAGINATION_CONFIG.LIMIT)
  // );

  const dealsList = await getDocs(collectionQuery);

  // Response
  if (dealsList.size > 0) {
    let deals = [];

    for (const deal of dealsList.docs) {
      // Get deal's restaurant
      const restaurant = await getDoc(
        doc(db, `Restaurants/${deal.get("restaurantId")}`)
      ).catch((err) => {
        console.error(err);
        return response.status(500).json({
          ...err,
          message: "No se encontró el restaurante.",
        });
      });

      // Filter Out Deals that are not valid
      if (!isDealValid(deal.data())) {
        continue;
      }

      // Filter out deals that are not active
      if (filterByActive && !isDealActive(deal.data())) {
        continue;
      }

      // Return deals
      deals.push({
        ...deal.data(),
        restaurant: restaurant.get("name"),
        id: deal.id,
        startsAt: deal.data().startsAt.toDate(),
        expiresAt: deal.data().expiresAt.toDate(),
        createdAt: deal.data().createdAt.toDate(),
      });
    }

    return response.json(deals);
  } else {
    return response.json([]);
  }
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

  if (docSnap.exists()) {
    // Filter Out Deals that are not valid
    if (!isDealValid(docSnap.data())) {
      return response.status(204).json({
        message: "No se encontró la oferta.",
      });
    }

    return response.json({
      id: docSnap.id,
      ...docSnap.data(),
      startsAt: docSnap.data().startsAt.toDate(),
      expiresAt: docSnap.data().expiresAt.toDate(),
      createdAt: docSnap.data().createdAt.toDate(),
    });
  } else {
    return response.status(204).json({
      message: "No se encontró la oferta.",
    });
  }
};
exports.updateDeal = async (request, response) => {
  const docRef = doc(db, `Deals/${request.params.dealId}`);
  const deal = await getDoc(docRef).catch((err) => {
    console.log(err);
    return response.status(500).json({
      ...err,
      message: "Error al obtener la oferta.",
    });
  });
  if (!deal.exists()) {
    return response.status(400).json({
      message: "No se encontró la oferta.",
    });
  }

  //
  const updateObject = {
    ...request.body,
    createdAt: deal.get("createdAt"),
    startsAt: Timestamp.fromDate(new Date(request.body.startsAt)),
    expiresAt: Timestamp.fromDate(new Date(request.body.expiresAt)),
  };

  // Update record
  updateDoc(docRef, updateObject)
    .then(() => {
      getDoc(docRef).then((documentSnapshot) => {
        response.json({
          ...documentSnapshot.data(),
          startsAt: documentSnapshot.data().startsAt.toDate(),
          expiresAt: documentSnapshot.data().expiresAt.toDate(),
          createdAt: documentSnapshot.data().createdAt.toDate(),
        });
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        message: "Error al actualizar la oferta.",
      });
    });
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

// Get Reservation List
exports.getReservationsList = async (request, response) => {
  const filtersList = [where("restaurantId", "==", request.params.restaurantId)];

  // Filter by 'active' state (true by default)
  if (request.query.active && request.query.active != "") {
    let filterByActive =
      request.query?.active && request.query?.active == "false" ? false : true;
    filtersList.push(where("active", "==", filterByActive));
  }

  // Filter by date range
  let range_init = request.query.range_init;
  if (range_init && range_init != "") {
    if (dayjs(request.query.range_init).isValid()) {
      range_init = dayjs(dayjs(request.query.range_init).toISOString())
        //.utcOffset(UTC_OFFSET, true)
        .toDate();

      filtersList.push(
        where("reservationDate", ">=", Timestamp.fromDate(range_init))
      );
    }
  }
  let range_end = request.query.range_end;
  if (range_end && range_end != "") {
    if (dayjs(request.query.range_end).isValid()) {
      range_end = dayjs(request.query.range_end)
        .hour(23)
        .minute(59)
        .second(59)
        //.utcOffset(UTC_OFFSET, true)
        .toDate();

      filtersList.push(
        where("reservationDate", "<=", Timestamp.fromDate(range_end))
      );
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

  // Get Deals collection results
  let collectionQuery = query(
    collection(db, `Reservations`),
    ...filtersList,
    orderBy("reservationDate", "desc")
  );
  const collectionReference = await getDocs(collectionQuery).catch((err) => {
    return response.status(500).json({
      ...err,
      message: "Error al obtener las reservaciones.",
    });
  });

  // Response
  if (collectionReference.size > 0) {
    let reservationsResults = [];
    for (let document of collectionReference.docs) {
      const reservation = document.data();

      // Get Deal
      const dealReference = doc(db, "Deals", reservation.dealId);
      const dealSnap = await getDoc(dealReference).catch((err) => {
        return response.status(500).json({
          ...err,
          message: "Error al obtener la oferta.",
        });
      });

      // Confirm that the reservation is linked to a deal
      if (!dealSnap.exists()) {
        continue;
      }

      // Determine status description
      let dealDetails;
      switch (dealSnap.data().dealType) {
        case 2:
          dealDetails = dealSnap.data().details
            ? `${dealSnap.data()?.details}.`
            : "";
          break;
        case 1:
        default:
          dealDetails = `${dealSnap.data().discount * 100}% de descuento.`;
      }

      // Get Customer from Firestore
      let customer = await getDoc(
        doc(db, "Users", reservation.customerId)
      ).catch((err) => {});
      let customerEmail = "Usuario no encontrado";
      if (customer.exists()) {
        customerEmail = customer.data().email;
      } else {
        // If user was not found, try to get it from Firebase Auth
        customer = await adminAuth.getUser(reservation.customerId);
        if (customer) {
          customerEmail = customer.email;
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
          ? dayjs(reservation.checkIn).toDate()
          : null,
        createdAt: reservation.createdAt.toDate(),
        reservationDate: reservation.reservationDate.toDate(),
        dealType: dealSnap.data().dealType,
        dealDetails,
        dealTerms: dealSnap.data().terms ? dealSnap.data().terms : "",
        customer: customerEmail,
      });
    }
    return response.json(reservationsResults);
  } else {
    return response.status(204).json({
      message: "No se encontraron reservaciones.",
    });
  }
};

// Create Category
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
// Get Categories
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
    return response.status(204).json({
      message: "No se encontraron menús.",
    });
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
    return response.status(204).json({
      message: "No se encontraron fotografías.",
    });
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

  //
  bb.on("file", (name, file, info) => {
    // upload image
    const image = uploadFiletoBucket(
      file,
      info,
      `Restaurants/${restaurantDocument.slug}/Photos`
    )
      .then(async (fileURLs) => {
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
        throw new Error(err);
      });

    // add write stream to array
    fileWrites.push(image);
  });

  bb.on("error", (err) => {
    functions.logger.error("Busboy error >>>>:", err);
  });

  bb.on("finish", async () => {
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
        const newRestaurantItem = {
          name: restaurant[0],
          slug: slugifyString(restaurant[0]),
          description: restaurant[1],
          deals: [],
          phone: restaurant[3],
          photo: restaurant[10],
          avatar: restaurant[9],
          qrCode: "",
          rating: restaurant[5],
          website: restaurant[4],
          createdAt: dayjs().toDate(),
          categories,
          address: restaurant[7],
          location: {
            ...location,
          },
          //email: request.user.email,
          //userId: request.user.uid,
          // _geoloc: {
          //     ...location
          // },
        };

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
