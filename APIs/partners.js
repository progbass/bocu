const functions = require("firebase-functions");
const { ref, uploadBytes, uploadString } = require("firebase/storage");
const { generateQrCode } = require("../utils/qr-code");
const { db, app, auth, storage } = require("../utils/admin");
const config = require("../utils/config");
const slugify = require("slugify");
const busboy = require("busboy");
const queryString = require("query-string");
const path = require("path");
const os = require("os");
const fs = require("fs");
const algoliasearch = require("algoliasearch");
const readXlsxFile = require('read-excel-file/node');
const dayjs = require("dayjs");
var utc = require("dayjs/plugin/utc");
var timezone = require("dayjs/plugin/timezone");
const { bucket } = require("firebase-functions/v1/storage");

// Config Algolia SDK
const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_ADMIN_API_KEY
);
const algoliaIndex = algoliaClient.initIndex("Restaurants");

// Dates configuration.
dayjs.extend(utc);
dayjs.extend(timezone);

// Config
const DEAL_EXPIRY_DEFAULT_OFFSET_HOURS = 2;
const UTC_OFFSET = -5;
const RESERVATION_STATUS = {
  AWAITING_CUSTOMER: 1,
  USER_CANCELED: 2,
  TOLERANCE_TIME: 3,
  RESERVATION_EXPIRED: 4, 
  RESERVATION_FULFILLED: 5,
  RESTAURANT_CANCELED: 6,
  OTHER: 7,
  DEAL_EXPIRED: 8,
  DEAL_CANCELED: 9
}

//
exports.createRestaurant = async (request, response) => {
  const restaurantCollection = db.collection("Restaurants");

  // Validate that restaurant does not exists.
  const existingRestaurant = await restaurantCollection
    .where('name', '==', request.body.name)
    .get();
  if(existingRestaurant.size > 0){
    return response.status(409).json({ error: 'Restaurant already exists.' });
  }

  // Validate that restaurant does not exists.
  const currentUserRestaurant = await restaurantCollection
    .where('userId', '==', request.user.uid)
    .get();
  if(currentUserRestaurant.size > 0){
    return response.status(403).json({ error: 'User already have a restaurant.' });
  }

  // Create restaurant.
  const newRestaurantItem = {
    name: request.body.name,
    categories: [],
    qrCode: '',
    photo: '',
    avatar: '',
    rating: 0,
    location: {},
    address: '',
    phone: '',
    description: '',
    instagram: '',

    ...request.body,
    slug: slugify(request.body.name?.toLowerCase()),
    active: false,
    isApproved: false,
    hasMinimumRequirements: false,
    email: request.user.email,
    userId: request.user.uid,
    createdAt: dayjs().toDate(),
  };
  restaurantCollection
    .add(newRestaurantItem)
    .then((documentRef) => {
      // Get new document
      documentRef.get().then(async (documentSnapshot) => {
        // Evaluate if restaurant has
        // the minimum requirements defined by the business
        const hasMinimumRequirements = !hasMissingRequirements(documentSnapshot.data());

        // Generate QR code
        const publicUrl = await generateQR(
          documentRef.id,
          `Restaurants/${documentSnapshot.data().slug}/qr_${
            documentRef.id
          }-${new Date().getTime()}.png`
        );

        // Update restaurant info
        await documentRef.update({
          qrCode: publicUrl,
          hasMinimumRequirements
        });

        // return new document
        const updatedDocument = await documentRef.get();
        const responseItem = {
          id: documentRef.id,
          ...updatedDocument.data(),
        };
        return response.json(responseItem);
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({ error: err.code });
    });
};
exports.editRestaurant = async (request, response) => {
  let restaurantReference = db
    .collection("Restaurants")
    .doc(`${request.user.restaurantId}`);
  let restaurant = await restaurantReference.get();

  // Validate that restaurant exists.
  if(!restaurant.exists){
      response.status(404).json({message: 'User restaurant not found.'});
  }
  
  // Update document.
  await restaurantReference
    .update(request.body)
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        error: err.code,
      });
    });
  
  // Get updated record
  restaurant = await restaurantReference.get();
  let restaurantData = restaurant.data();

  // Evaluate if restaurant has
  // the minimum requirements defined by the business
  const hasMinimumRequirements = !hasMissingRequirements(restaurantData);
  
  // Update restaurant 'minimum requirements' property
  await restaurantReference
    .update({ hasMinimumRequirements })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        error: err.code,
      });
    });

  // Get updated record
  restaurant = await restaurantReference.get();

  // Response
  response.json(restaurant.data());
};

// Create deal
exports.createDeal = async (request, response) => {
  // Define expiry date settings
  const createdAt = dayjs.utc().utcOffset(UTC_OFFSET);

  let expiryTimeParts = request.body.expiresAt
    ? request.body.expiresAt
    : createdAt.add(DEAL_EXPIRY_DEFAULT_OFFSET_HOURS, "hour").format("hh:mm");
  expiryTimeParts = expiryTimeParts.split(":");
  const expiresAt = createdAt
    .set("hour", expiryTimeParts[0])
    .set("minutes", expiryTimeParts[1]);

  let startTimeParts = request.body.startsAt
    ? request.body.startsAt
    : createdAt.format("hh:mm");
  startTimeParts = startTimeParts.split(":");
  const startsAt = createdAt
    .set("hour", startTimeParts[0])
    .set("minutes", startTimeParts[1]);

  // Create deal.
  let newDealItem = {
    userId: request.user.uid,
    restaurantId: request.user.restaurantId,
    createdAt: app.firestore.Timestamp.fromDate(createdAt.toDate()),
    dealType: Number(request.body.dealType),
    details: request.body.details ? request.body.details : "",
    discount: request.body.discount > 0 ? request.body.discount : 0,
    startsAt: app.firestore.Timestamp.fromDate(startsAt.toDate()),
    expiresAt: app.firestore.Timestamp.fromDate(expiresAt.toDate()),
    include_drinks: request.body.include_drinks || false,
    useCount: 0,
    useMax: Number(request.body.useMax),
    active: true,
    terms: request.body.terms ? request.body.terms : "",
  };

  // Get restaurant
  let collectionRef = db.collection("Restaurants")
    .where("userId", "==", request.user.uid);
  let document = await collectionRef.get()
    .catch((err) => {
      return response.status(500).json({
        error: err.code,
      });
    });
    
  // No restaurant found.
  if (document.size < 1) {
    return response.status(204).json({
      error: "Restaurant was not found.",
    });
  }

  // Get last restaurant.
  let restaurant = document.docs[document.size - 1];
  newDealItem = {
    restaurantId: restaurant.id,
    ...newDealItem,
  };

  //
  db.collection("Deals")
    .add(newDealItem)
    .then(async (documentRef) => {
      const doc = await documentRef.get();
      return response.json({
        ...newDealItem,
        id: doc.id,
        startsAt: dayjs
          .unix(doc.data().startsAt.seconds)
          .utcOffset(UTC_OFFSET)
          .format("HH:mm"),
        expiresAt: dayjs
          .unix(doc.data().expiresAt.seconds)
          .utcOffset(UTC_OFFSET)
          .format("HH:mm"),
        createdAt: dayjs
          .unix(doc.data().createdAt.seconds)
          .utcOffset(UTC_OFFSET),
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({ error: err.code });
    });
};
// Get Deals List
exports.getDeals = async (request, response) => {
  // Build query
  let collectionReference = db
    .collection(`Deals`)
    .where("restaurantId", "==", request.user.restaurantId);

  // Filter by 'active' state (true by default)
  if(request.query?.active){
    let filterActive = request.query?.active && request.query?.active == 'false' ? false : true;
    collectionReference = collectionReference.where("active", "==", filterActive);
  }

  // Get collection
  //collectionReference = collectionReference.orderBy('createdAt', 'desc');
  const collection = await collectionReference.get().catch((err) => {
    return response.status(500).json({
      error: err.code,
    });
  });

  // Response
  if (collection.size > 0) {
    let deals = [];
    collection.forEach((doc) => {
      deals.push({
        ...doc.data(),
        id: doc.id,
        startsAt: dayjs
          .unix(doc.data().startsAt?.seconds)
          .utcOffset(UTC_OFFSET)
          .format("HH:mm"),
        expiresAt: dayjs
          .unix(doc.data().expiresAt?.seconds)
          .utcOffset(UTC_OFFSET)
          .format("HH:mm"),
        createdAt: dayjs
          .unix(doc.data().createdAt?.seconds)
          .utcOffset(UTC_OFFSET),
      });
    });
    return response.json(deals);
  } else {
    return response.status(204).json({
      error: "No deals were found.",
    });
  }
};
// Get Deal
exports.getDeal = async (request, response) => {
  console.log(request.params.dealId);
  const docRef = db.doc(`Deals/${request.params.dealId}`);
  const docSnap = await docRef.get().catch((err) => {
    return response.status(500).json({
      error: err.code,
    });
  });

  if (docSnap.exists) {
    return response.json({
      id: docSnap.id,
      ...docSnap.data(),
      startsAt: dayjs
        .unix(docSnap.data().startsAt.seconds)
        .utcOffset(UTC_OFFSET)
        .format("HH:mm"),
      expiresAt: dayjs
        .unix(docSnap.data().expiresAt.seconds)
        .utcOffset(UTC_OFFSET)
        .format("HH:mm"),
      createdAt: dayjs
        .unix(docSnap.data().createdAt.seconds)
        .utcOffset(UTC_OFFSET),
    });
  } else {
    return response.status(204).json({
      error: "The deal was not found.",
    });
  }
};
// Update deal
exports.updateDeal = async (request, response) => {
  const docRef = db.doc(`Deals/${request.params.dealId}`);
  const deal = await docRef.get();
  if (!deal.exists) {
    return response.status(400).json({
      error: "Deal not found.",
    });
  }

  //
  const updateObject = request.body;

  // Transform hh:mm into a valid date before storing into database
  if (updateObject.startsAt) {
    const currentStartTime = dayjs
      .unix(deal.data().startsAt.seconds)
      .utc()
      .utcOffset(UTC_OFFSET);
    let startTimeParts = updateObject.startsAt.split(":");
    const startsAt = currentStartTime
      .set("hour", startTimeParts[0])
      .set("minutes", startTimeParts[1]);

    // ToDo: Validate date or return error

    // Overwrite original data
    updateObject.startsAt = app.firestore.Timestamp.fromDate(startsAt.toDate());
  }
  if (updateObject.expiresAt) {
    const currentExpiryTime = dayjs
      .unix(deal.data().expiresAt.seconds)
      .utc()
      .utcOffset(UTC_OFFSET);
    let expiryTimeParts = updateObject.expiresAt.split(":");
    const expiresAt = currentExpiryTime
      .set("hour", expiryTimeParts[0])
      .set("minutes", expiryTimeParts[1]);

    // ToDo: Validate date or return error

    // Overwrite original data
    app.firestore.Tim;
    updateObject.expiresAt = app.firestore.Timestamp.fromDate(
      expiresAt.toDate()
    );
  }

  // Update record
  docRef
    .update(updateObject)
    .then(() => {
      docRef.get().then((documentSnapshot) => {
        response.json({
          ...documentSnapshot.data(),
          startsAt: dayjs
            .unix(documentSnapshot.data().startsAt.seconds)
            .utcOffset(UTC_OFFSET)
            .format("HH:mm"),
          expiresAt: dayjs
            .unix(documentSnapshot.data().expiresAt.seconds)
            .utcOffset(UTC_OFFSET)
            .format("HH:mm"),
          createdAt: dayjs
            .unix(documentSnapshot.data().createdAt.seconds)
            .utcOffset(UTC_OFFSET),
        });
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        error: err.code,
      });
    });
};
// Delete deal
exports.deleteDeal = async (request, response) => {
  const docRef = db.doc(`Deals/${request.params.dealId}`);

  // Verify that document exists
  const deal = await docRef.get();
  if(!deal.exists){
    return response.status(404).json({
      error: 'Deal not found.',
    });
  }

  // Delete from db
  await docRef
    .delete()
    .catch((err) => {
      return response.status(500).json({
        error: err.code,
      });
    });

  // Response
  return response.json({
    message: "Deal deleted successfully.",
  });
};

// Get Reservation List
exports.getReservationsList = async (request, response) => {
  const todayDate = dayjs.utc().utcOffset(UTC_OFFSET);

  // Get Deals collection
  let collectionReference = db
    .collection(`Reservations`)
    .where("restaurantId", "==", request.user.restaurantId)

  // Filter by 'active' state (true by default)
  if(request.query.active){
    let filterActive = request.query?.active && request.query?.active == 'false' ? false : true;
    collectionReference = collectionReference.where("active", "==", filterActive);
  }

  // Filter by date range
  let range_init = request.query.range_init;
  if (range_init != undefined) {
    if(dayjs(request.query.range_init).isValid()){
    range_init = dayjs(dayjs(request.query.range_init).toISOString())
      //.utcOffset(UTC_OFFSET, true)
      .toDate()

      collectionReference = collectionReference.where(
        "reservationDate",
        ">=",
        app.firestore.Timestamp.fromDate(range_init)
      )
    }
  }
  let range_end = request.query.range_end;
  if (range_end != undefined) {
    if(dayjs(request.query.range_end).isValid()){
      range_end = dayjs(request.query.range_end)
        .hour(23)
        .minute(59)
        .second(59)
        //.utcOffset(UTC_OFFSET, true)
        .toDate()
    
      collectionReference = collectionReference.where(
        "reservationDate", 
        "<=", 
        app.firestore.Timestamp.fromDate(range_end)
      )
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
        statusCode = RESERVATION_STATUS.RESERVATION_FULFILLED;
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
    collectionReference = collectionReference.where("status", "==", statusCode);
  }

  // Get collection results
  collectionReference = collectionReference.orderBy('reservationDate', 'desc');
  const collection = await collectionReference.get().catch((err) => {
    return response.status(500).json({
      error: err,
    });
  });

  // Response
  if (collection.size > 0) {
    let deals = [];
    for (doc of collection.docs) {
      // Get Deal
      const dealReference = db.collection("/Deals/").doc(doc.data().dealId);
      const dealSnap = await dealReference.get().catch((err) => {
        return response.status(500).json({
          error: err.code,
        });
      });

      // Confirm that the reservation is linked to a deal
      if(!dealSnap.exists){
        continue;
      }

      // Determine status description
      let dealDetails;
      switch (dealSnap.data().dealType) {
        case 2:
          dealDetails = `${dealSnap.data().description}.`;
          break;
        case 1:
        default:
          dealDetails = `${dealSnap.data().discount * 100}% de descuento.`;
      }

      // Get User
      const userSnap = await auth.getUser(doc.data().customerId);
      const user = userSnap.toJSON();

      // Determine status description
      let statusDescription = "Reservación activa";
      switch (doc.data().status) {
        case 2:
          statusDescription = "Reservación cancelada";
          break;
        case 3:
          statusDescription = "Esperando cliente";
          break;
        case 4:
          statusDescription = "Oferta redimida";
          break;
        case 1:
        default:
          statusDescription = "Reservación activa";
      }

      deals.push({
        id: doc.id,
        ...doc.data(),
        statusDescription,
        checkIn: doc.data().checkIn ? dayjs(doc.data().checkIn).toDate() : null,
        createdAt: dayjs.unix(doc.data().createdAt.seconds).toDate(),
        reservationDate: dayjs
          .unix(doc.data().reservationDate.seconds)
          .toDate(),
        dealType: dealSnap.data().dealType,
        dealDetails,
        customer: user.email,
      });
    }
    return response.json(deals);
  } else {
    return response.status(204).json({
      error: "No reservations were found.",
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
    slug: slugify(request.body.name) || "",
  };

  // Insert Category
  db.collection("Categories")
    .add(newCategoryItem)
    .then((documentRef) => {
      return response.json({
        id: documentRef.id,
        ...newCategoryItem,
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({ error: err.code });
    });
};
// Get Categories
exports.getCategories = async (request, response) => {
  // Get Deals collection
  const collection = await db
    .collection(`Categories`)
    .get()
    .catch((err) => {
      return response.status(500).json({
        error: err.code,
      });
    });

  // Response
  if (collection.size > 0) {
    let categories = [];
    collection.forEach((doc) => {
      categories.push({
        ...doc.data(),
        id: doc.id,
      });
    });
    return response.json(categories);
  } else {
    return response.status(204).json({
      error: "No categories were found.",
    });
  }
};

// Get Menus
exports.getRestaurantMenus = async (request, response) => {
  // Get Menus collection
  const collection = await db
    .collection(`RestaurantMenus`)
    .where("restaurantId", "==", request.user.restaurantId)
    .get()
    .catch((err) => {
      return response.status(500).json({
        error: err.code,
      });
    });

  // Response
  if (collection.size > 0) {
    let menus = [];
    collection.forEach((doc) => {
      menus.push({
        ...doc.data(),
        id: doc.id,
      });
    });
    return response.json(menus);
  } else {
    return response.status(204).json({
      error: "No menus were found.",
    });
  }
};
// Post Menus
exports.postRestaurantMenu = async (request, response) => {
  // Get restaurant document
  const restaurantDocRef = db.doc(`/Restaurants/${request.user.restaurantId}`);
  const restaurantDocument = (await restaurantDocRef.get()).data();

  // Get Menus
  const menusCollectionRef = db
    .collection(`RestaurantMenus`)
    .where("restaurantId", "==", request.user.restaurantId)
    .where("active", "==", true);
  const menusCollection = await menusCollectionRef.get().catch((err) => {
    return response.status(500).json({
      error: err.code,
    });
  });
  // Validate maximum of items
  if (menusCollection.size >= 10) {
    return response.status(400).json({ error: "Limit of items exceeded." });
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
      return response.status(400).json({ error: "Wrong file type submited" });
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
    const bucket = app.storage().bucket();
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
      .catch((error) => {
        console.error(error);
        return response.status(500).json({ error: error.code });
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
    await db.collection(`RestaurantMenus`).add(newMenu);

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
  const collection = await db
    .collection(`RestaurantPhotos`)
    .where("restaurantId", "==", request.user.restaurantId)
    .get()
    .catch((err) => {
      return response.status(500).json({
        error: err.code,
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
      error: "No photos were found.",
    });
  }
};
// Post Gallery Photo
exports.postRestaurantPhoto = async (request, response) => {
  // Get restaurant document
  const restaurantDocRef = db.doc(`/Restaurants/${request.user.restaurantId}`);
  const restaurantDocument = (await restaurantDocRef.get()).data();

  // Get Menus
  const photosCollectionRef = db
    .collection(`RestaurantPhotos`)
    .where("restaurantId", "==", request.user.restaurantId)
    .where("active", "==", true);
  const photosCollection = await photosCollectionRef.get().catch((err) => {
    return response.status(500).json({
      error: err.code,
    });
  });
  // Validate maximum of items
  if (photosCollection.size >= 10) {
    return response.status(400).json({ error: "Limit of items exceeded." });
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
      mimeType !== "image/png" &&
      mimeType !== "image/jpeg" &&
      mimeType !== "image/jpg"
    ) {
      return response.status(400).json({ error: "Wrong file type submited" });
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
    const bucket = app.storage().bucket();
    const destination = `Restaurants/${restaurantDocument.slug}/Gallery/${imageToBeUploaded.imageFileName}`;
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
      .catch((error) => {
        console.error(error);
        return response.status(500).json({ error: error.code });
      });

    // Create new registry
    const file = await bucket.file(destination);
    const fileURL = await file.publicUrl();
    const newPhoto = {
      restaurantId: restaurantDocument.id,
      active: true,
      createdAt: new Date().toISOString(),
      file: fileURL,
      thumbnail: "",
    };
    await db.collection(`RestaurantPhotos`).add(newPhoto);

    // Response
    const photosList = [];
    (await photosCollectionRef.get()).forEach((item) => {
      photosList.push({ ...item.data(), id: item.id });
    });
    return response.json(photosList);
  });
  BB.end(request.rawBody);
};
// Delete photo
deleteImage = (imageName) => {
  const bucket = app.storage().bucket();
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
exports.uploadRestaurantProfilePhoto2 = async (request, response) => {
  cors(request, response, async () => {
    // Get restaurant document
    const restaurantDocRef = await db.doc(
      `/Restaurants/${request.user.restaurantId}`
    );
    const restaurantDocument = await (await restaurantDocRef.get()).data();

    // BusBoy
    const path = require("path");
    const os = require("os");
    const fs = require("fs");
    const BB = busboy({ headers: request.headers });

    // Image config
    let imageFileName;
    let imageToBeUploaded = {};

    //
    BB.on("file", (name, file, info) => {
      const { filename, encoding, mimeType } = info;

      // Validate file format
      if (
        mimeType !== "image/png" &&
        mimeType !== "image/jpeg" &&
        mimeType !== "image/jpg"
      ) {
        return response.status(400).json({ error: "Wrong file type submited" });
      }

      // Name file
      const imageExtension =
        filename.split(".")[filename.split(".").length - 1];
      imageFileName = `${new Date().toISOString()}.${imageExtension}`;
      const filePath = path.join(os.tmpdir(), imageFileName);
      imageToBeUploaded = { filePath, mimeType, imageFileName };
      file.pipe(fs.createWriteStream(filePath));
    });

    // Delete current image if exists
    deleteImage(imageFileName);

    // When finishing upload, store file on Firebase
    BB.on("finish", async () => {
      const bucket = app.storage().bucket();
      const destination = `Restaurants/${restaurantDocument.slug}/Avatars/${imageToBeUploaded.imageFileName}`;
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
        .catch((error) => {
          console.error(error);
          return response.status(500).json({ error: error.code });
        });

      // Update restaurant avatar URL
      const file = await bucket.file(destination);
      const fileURL = await file.publicUrl();
      await restaurantDocRef.update({
        photo: fileURL,
      });

      // Response
      return response.json(restaurantDocument);
    });
    BB.end(request.rawBody);
  });
};
exports.uploadRestaurantProfilePhoto = async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  //cors(request, response, async () => {
  // Get restaurant document
  const restaurantDocRef = await db.doc(
    `/Restaurants/${request.user.restaurantId}`
  );
  let restaurantDocument = (await restaurantDocRef.get()).data();

  // BusBoy
  const bb = busboy({ headers: request.headers });

  // Image config
  let imageFileName;
  let imageToBeUploaded = {};
  const fileWrites = [];
  /*
  const base64File = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAoCAYAAAC4h3lxAAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAALaSURBVHgB1ZlNVhpBEMerukfN0iNwBDyBeALDiy6yiDqbGFbGEwRPELPI48lmJC7yXtQ35ASQE8gRyAnC2sdUpasRREDowQHp32Y+Xk9N/aeqa6ZrEBypRNeFIAi2CSgPDPn+eQRsI3Crm9DvUrjfhBRYm1rtMmKemXPWHnIHWHUSTv4AQXOWTYRZN/lxe6QQT4A5D7NpE8BZ6eDd5bRB1Vp8wkhls7sJL7T5rIBK9DOng43IPJkCpKdNyf1OKXzfHre5FjOjy8Nwsqkmjby4unmr9PrdnM4LOble7IzbnMv5iTaFsQjYAYwxZIRmPJJtgnwJWYFcPP6wV7e7w+clxKIS3HLTlU7G9qxNk05bkk5PUsg431jAzbK2Z21qvRHJziACttoAROARpjqFgwiYnS/gGRrw0EagGv3Ks9Z34CE2Al3QBfAUKyDQsA2e0psDyIuoFEvBCuDFlLqloMBzrADsvS29xApICP6Cp/TmAGELPOUhhchbAYNvoYva7T9z5Fc1Ynj8GjVr3W/gGYRwNhDwhoJzUQS+YHyVdfJAQBgWO0QUgifI05ftkxeZtDDMOnjlU4n4sUsxsStRvbppmMV3AVYQZG59PNzb6h9P/JRY6+qiWdivXmk1eb9Gemf41EQBvfmAxZWa1MYXIrUjvg2fntqZi6J4815xw8Rt3l5OJkjayJMfdV6Y+jUqF6wTSsjq8HrUn3NemNkb7VOpXZcVqqUu/KUifjrc+zxtjLMAYbki6PT4YP981qhUAgRpiSulInNlDhYBg7xQi66t+tQChEoU55SiRuYiHipNKSy2XS+Za0kpN1gntUXMNcgIsSU20zgvzBWBYbKZF275PokXCxC+R3E+UBSnTimbMhSm/TU1TCYChN684Nj1pcfITe7qMG3KjJKZgD4uKeVS313JXIBgW/UMX8eWqLZEwmkpnP4TMA0LESBISoFKygpwV45ZcSuLlBnlPxluQJqYt7wLAAAAAElFTkSuQmCC";

  const destination = `/Restaurants`; //${restaurantDocument.slug}/Avatars/${imageToBeUploaded.imageFileName}`;
  //const storageRef = app.storage().ref().child(destination);
  
  const storageRef = ref(app.storage().bucket()) //ref(storage, destination)//app.storage().bucket();
  let imageRef;
  console.log(app.storage().app.)
  // await uploadString(storageRef, base64File)
  //   .catch(err => console.log(err))
  // console.log('success')
  return
  // storageRef.getDownloadURL().then(function(url) {
  //   imageRef.child("image").set(url);
  // }); 
  // storageRef.storage().ref()
  
  const task = storageRef.putString(
    "iVBORw0KGgoAAAANSUhEUgAAADAAAAAoCAYAAAC4h3lxAAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAALaSURBVHgB1ZlNVhpBEMerukfN0iNwBDyBeALDiy6yiDqbGFbGEwRPELPI48lmJC7yXtQ35ASQE8gRyAnC2sdUpasRREDowQHp32Y+Xk9N/aeqa6ZrEBypRNeFIAi2CSgPDPn+eQRsI3Crm9DvUrjfhBRYm1rtMmKemXPWHnIHWHUSTv4AQXOWTYRZN/lxe6QQT4A5D7NpE8BZ6eDd5bRB1Vp8wkhls7sJL7T5rIBK9DOng43IPJkCpKdNyf1OKXzfHre5FjOjy8Nwsqkmjby4unmr9PrdnM4LOble7IzbnMv5iTaFsQjYAYwxZIRmPJJtgnwJWYFcPP6wV7e7w+clxKIS3HLTlU7G9qxNk05bkk5PUsg431jAzbK2Z21qvRHJziACttoAROARpjqFgwiYnS/gGRrw0EagGv3Ks9Z34CE2Al3QBfAUKyDQsA2e0psDyIuoFEvBCuDFlLqloMBzrADsvS29xApICP6Cp/TmAGELPOUhhchbAYNvoYva7T9z5Fc1Ynj8GjVr3W/gGYRwNhDwhoJzUQS+YHyVdfJAQBgWO0QUgifI05ftkxeZtDDMOnjlU4n4sUsxsStRvbppmMV3AVYQZG59PNzb6h9P/JRY6+qiWdivXmk1eb9Gemf41EQBvfmAxZWa1MYXIrUjvg2fntqZi6J4815xw8Rt3l5OJkjayJMfdV6Y+jUqF6wTSsjq8HrUn3NemNkb7VOpXZcVqqUu/KUifjrc+zxtjLMAYbki6PT4YP981qhUAgRpiSulInNlDhYBg7xQi66t+tQChEoU55SiRuYiHipNKSy2XS+Za0kpN1gntUXMNcgIsSU20zgvzBWBYbKZF275PokXCxC+R3E+UBSnTimbMhSm/TU1TCYChN684Nj1pcfITe7qMG3KjJKZgD4uKeVS313JXIBgW/UMX8eWqLZEwmkpnP4TMA0LESBISoFKygpwV45ZcSuLlBnlPxluQJqYt7wLAAAAAElFTkSuQmCC",
    'base64'
  ).then(function(snapshot) {
    console.log('Uploaded a base64 string!');
  });

  return;*/
  //functions.logger.log("Before File: ", request.file);

  bb.on("file", (name, file, info) => {
    const { filename, encoding, mimeType, size } = info;
    functions.logger.log("File>>>>:", size);

    const imageExtension = filename.split(".")[filename.split(".").length - 1];
    imageFileName = `${new Date().toISOString()}.${imageExtension}`;
    const filePath = path.join(os.tmpdir(), imageFileName);

    imageToBeUploaded = { filePath, mimeType, imageFileName };
    const writeStream = fs.createWriteStream(filePath);
    file.pipe(writeStream);

    const promise = new Promise((resolve, reject) => {
      file.on("end", () => {
        writeStream.end();
      });
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
    file.on("error", function (err) {
      console.log("Error ", err);
      // do whatever you want with your error
    });
    fileWrites.push(promise);
  });
  bb.on("error", (err) => {
    console.log("Error!: ", err);
  });
  bb.on("finish", async () => {
    await Promise.all(fileWrites);

    const bucket = app.storage().bucket();
    const destination = `Restaurants/${restaurantDocument.slug}/Avatars/${imageToBeUploaded.imageFileName}`;
    functions.logger.log("path: ", imageToBeUploaded);
    
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
      .catch((error) => {
        console.error(error);
        return response.status(500).json({ error: error.code });
      });

    // // Response
    const file = await bucket.file(destination);
    const fileURL = await file.publicUrl();
    await restaurantDocRef.update({
      photo: fileURL,
    });
    restaurantDocument = (await restaurantDocRef.get()).data();
//https://us-central1-bocu-b909d.cloudfunctions.net/api/restaurant/image/
//http://localhost:5001/bocu-b909d/us-central1/api/restaurant/image/
    functions.logger.log("after send. ", restaurantDocument.get('photo'));
    console.log(restaurantDocument.get('photo'))
    response.json(restaurantDocument);
  });

  // functions.logger.log('enf of file')
  //return request.pipe(bb);
  bb.end(request.rawBody);
  //response.json({});
  //});
};
exports.uploadRestaurantProfilePhoto64 = async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");

  const {file: data, filename} = request.body;
  const defaultMimeType = '';

  // Get restaurant document
  const restaurantDocRef = await db.doc(
    `/Restaurants/${request.user.restaurantId}`
  );

  // Image config
  let imageFileName;
  const imageExtension = filename.split(".")[filename.split(".").length - 1];
  imageFileName = `${new Date().toISOString()}.${imageExtension}`;
  const file = app.storage().bucket().file(imageFileName);

  // Save media
  const fileOptions = {
    public: true,
    resumable: false,
    metadata: { contentType: base64MimeType(data) || defaultMimeType },
    validation: false
  }
  if (typeof data === 'string') {
    const base64EncodedString = data.replace(/^data:\w+\/\w+;base64,/, '')
    const fileBuffer = Buffer.from(base64EncodedString, 'base64')
    await file.save(fileBuffer, fileOptions);
  } else {
    await file.save(get(data, 'buffer', data), fileOptions);
  }

  // Get new file settings
  const fileURL = await file.publicUrl();
  const [metadata] = await file.getMetadata()

  // Update restaurant
  await restaurantDocRef.update({
    photo: fileURL,
  });
  
  // Response
  return response.json({
    ...metadata,
    fileURL
  });
};

//////////
exports.importRestaurants = async (request, response) => {
    // File path.
    readXlsxFile('Restaurants-List-Mockup.xlsx', { sheet: 2 }).then((rows) => {
        let index = 0;
        
        // Loop through rows
        for (const restaurant of rows){
            if(index != 0){
                let categories = restaurant[6].split(',');
                categories = categories.map((cat, index) => {
                  return {
                    "id": "",
                    "name": cat,
                    "slug": slugify(cat)
                  }
                });
                let location = restaurant[8].split(', ');
                location = { latitude: Number(location[0]), longitude: Number(location[1]) }

                // Create restaurant.
                const newRestaurantItem = {
                    name: restaurant[0],
                    slug: slugify(restaurant[0].toLowerCase()),
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
                      ...location
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
                db.collection("Restaurants")
                  .add(newRestaurantItem)
                  .then((documentRef) => {
                    // Get new document
                    documentRef.get().then(async (documentSnapshot) => {
                      const publicUrl = await generateQR(
                        documentRef.id,
                        `Restaurants/${documentSnapshot.data().slug}/qr_${
                          documentRef.id
                        }-${new Date().getTime()}.png`
                      );

                      // register QR URL to database
                      await documentRef.update({
                        qrCode: publicUrl,
                      });

                      // return new document
                      const updatedDocument = await documentRef.get();
                      const responseItem = {
                        id: documentRef.id,
                        ...updatedDocument.data(),
                      };
                      //   response.json(responseItem);
                    });
                  })
                  .catch((err) => {
                    console.error(err);
                    return response.status(500).json({ error: err.code });
                  });
            }

            // increment counter
            index++;
        }
    })

    return response.json({});
    // TODO: validate if user exists.
  
    // TODO: Validate that restaurant exists.
  
    
    db.collection("Restaurants")
      .add(newRestaurantItem)
      .then((documentRef) => {
        // Get new document
        documentRef.get().then(async (documentSnapshot) => {
          const stg = app.storage();
  
          // generate QR code
          // var QRCode = require('qrcode')
          // const qrCode = await QRCode.toDataURL(documentRef.id, {scale: 20, color: {dark: '#E53E3A'}})
  
          // // upload QR to bucket
          // const metadata = {
          //     public: true,
          //     resumable: false,
          //     metadata: { contentType: base64MimeType(qrCode) || '' },
          //     validation: false
          // };
  
          // const bucket = stg.bucket(config.storageBucket);
          // const file = bucket.file(`Restaurants/${documentSnapshot.data().slug}/qr_${documentRef.id}-${new Date().getTime()}.png`);
          // const base64EncodedString = qrCode.replace(/^data:\w+\/\w+;base64,/, '')
          // const fileBuffer = Buffer.from(base64EncodedString, 'base64')
          // await file.save(fileBuffer, metadata);
  
          const publicUrl = await generateQR(
            documentRef.id,
            `Restaurants/${documentSnapshot.data().slug}/qr_${
              documentRef.id
            }-${new Date().getTime()}.png`
          );
          // register QR URL to database
          await documentRef.update({
            qrCode: publicUrl,
          });
  
          // return new document
          const updatedDocument = await documentRef.get();
          const responseItem = {
            id: documentRef.id,
            ...updatedDocument.data(),
          };
          return response.json(responseItem);
        });
      })
      .catch((err) => {
        console.error(err);
        return response.status(500).json({ error: err.code });
      });
  };
exports.updateAllRestaurants = async (request, response) => {
  const restaurantsReference = db.collection('Restaurants');
  const restaurants = await restaurantsReference.get();

  if(restaurants.size){
    for(const restaurant of restaurants.docs){
      //const restaurantData = restaurant.data();
      await restaurant.ref.update({
        ...request.body
        //schedules: request.body.schedules.map(item => {return {...item, active: true }})
      }).catch((err) => {
        console.error(err);
        return response.status(500).json({ error: err.code });
      });
    }
    return response.json({ state: 'Updated restaurants successfully.' });
  }

  ///
  return response.json({ state: 'No restaurants found.' });
};
  


// Verify restaurant availability
exports.isRestaurantNameAvailable = (request, response) => {
  // TODO: Validate for case sensitive.
  let document = db
    .collection("Restaurants")
    .where("name", "==", `${request.params.restaurantName}`)
    .get()
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
        error: err.code,
      });
    });
};

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
  const stg = app.storage();

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
  if(name != undefined && name != '' ){
    return true;
  }
  return false;
}
const validateAddress = (address) => {
  // Address validations
  if(address != undefined && address != ''){
    return true
  }
  return false;
}
const validatePhone = (phone) => {
  // Phone validations
  if(phone != undefined && phone != ''){
    return true
  }
  return false;
}

const getMissingRequirements = (restaurant) => {
  const requiredValidations = [{
    operation: validateAddress,
    field: 'address',
    args: [restaurant.address],
    error: 'Dirección obligatoria.',
  }, {
    operation: validateName,
    field: 'name',
    args: [restaurant.name],
    error: 'Nombre del restaurante obligatorio.',
  }, {
    operation: validatePhone,
    field: 'phone',
    args: [restaurant.phone],
    error: 'Teléfono de contacto obligatorio.',
  }]

  // Execute validations and get detils on missing information
  const missingRequirements = requiredValidations.reduce((requirements, validation) => {
    if(!validation.operation(...validation.args)){
      return [...requirements, {
        missingField: validation.field,
        message: validation.error
      }];
    }

    return requirements
  }, []);

  //
  return missingRequirements;
}
const hasMissingRequirements = (restaurant) => {
  return getMissingRequirements(restaurant).length > 0;
}