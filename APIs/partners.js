const functions = require("firebase-functions");
const { generateQrCode } = require("../utils/qr-code");
const { db, app, auth } = require("../utils/admin");
const config = require("../utils/config");
const slugify = require("slugify");
const busboy = require("busboy");
const queryString = require("query-string");
const path = require("path");
const os = require("os");
const fs = require("fs");
const dayjs = require("dayjs");
var utc = require("dayjs/plugin/utc");
var timezone = require("dayjs/plugin/timezone");

// Dates configuration.
dayjs.extend(utc);
dayjs.extend(timezone);

// Config
const DEAL_EXPIRY_DEFAULT_OFFSET_HOURS = 2;
const UTC_OFFSET = -5;

//
exports.createRestaurant = (request, response) => {
  // TODO: validate if user exists.

  // TODO: Validate that restaurant exists.

  // Create restaurant.
  const newRestaurantItem = {
    name: request.body.name,
    slug: slugify(request.body.name),
    ...request.body,
    email: request.user.email,
    userId: request.user.uid,
    createdAt: dayjs().toDate(),
    categories: [],
    qrCode: "",
    photo: "",
    rating: 0,
    location: {},
  };
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
exports.editRestaurant = (request, response) => {
  // TODO: Validate that restaurant exists.
  // if(request.body.restaurantId || request.body.createdAt){
  //     response.status(403).json({message: 'Not allowed to edit'});
  // }

  let document = db
    .collection("Restaurants")
    .doc(`${request.user.restaurantId}`);
  document
    .update(request.body)
    .then(() => {
      document.get().then((documentSnapshot) => {
        response.json(documentSnapshot.data());
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        error: err.code,
      });
    });
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

  // Apply filters
  if (request.query.active != undefined) {
    collectionReference = collectionReference.where(
      "active",
      "==",
      request.query.active == "true" || false
    );
  }

  // Get collection
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
  const docSnap = await docRef.delete().catch((err) => {
    return response.status(500).json({
      error: err.code,
    });
  });

  return response.json({
    message: "Success",
  });
};

// Get Reservation List
exports.getReservationsList = async (request, response) => {
  let active = request.query?.active == "true";
  let range_init = request.query.range_init;
  let range_end = request.query.range_end;
  const todayDate = dayjs.utc().utcOffset(UTC_OFFSET); //new Date().toISOString();

  // Get Deals collection
  let collectionReference = db
    .collection(`Reservations`)
    .where("restaurantId", "==", request.user.restaurantId)
    .where("active", "==", active);

  // Filter by date range
  if (range_init != undefined) {
    range_init = dayjs(request.query.range_init).isValid()
      ? dayjs(dayjs(request.query.range_init).toISOString())
          .utcOffset(UTC_OFFSET, true)
          .toDate()
      : dayjs(todayDate).utcOffset(UTC_OFFSET, true).toDate();
  } else {
    range_init = todayDate
      .set("date", 1)
      .hour(0)
      .minute(0)
      .second(0)
      .utcOffset(UTC_OFFSET, true)
      .toDate();
  }
  if (range_end) {
    range_end = dayjs(request.query.range_end).isValid()
      ? dayjs(request.query.range_end)
          .hour(23)
          .minute(59)
          .second(59)
          .utcOffset(UTC_OFFSET, true)
          .toDate()
      : dayjs(todayDate).add(1, "month").utcOffset(UTC_OFFSET, true).toDate();
  } else {
    range_end = todayDate
      .date(todayDate.daysInMonth())
      .hour(23)
      .minute(59)
      .second(59)
      .add(1, "month")
      .utcOffset(UTC_OFFSET, true)
      .toDate();
  }

  if (request.query.status) {
    let statusCode;
    switch (request.query.status) {
      case "fulfilled":
        statusCode = 4;
        break;
      case "canceled":
        statusCode = 3;
        break;
      case "awaiting":
        statusCode = 2;
        break;
      default:
      case "active":
        statusCode = 1;
        break;
    }
    collectionReference = collectionReference.where("status", "==", statusCode);
  }

  // Get collection results
  collectionReference = collectionReference
    .where(
      "reservationDate",
      ">=",
      app.firestore.Timestamp.fromDate(range_init)
    )
    .where("reservationDate", "<=", app.firestore.Timestamp.fromDate(range_end))
    .orderBy("reservationDate");

  const collection = await collectionReference.get().catch((err) => {
    return response.status(500).json({
      error: err,
    });
  });

  // Response
  if (collection.size > 0) {
    let deals = [];
    for (doc of collection.docs) {
      console.log(
        doc.id,
        dayjs.unix(doc.data().reservationDate.seconds).toDate(),
        dayjs(range_end).toDate(),
        doc.data().reservationDate <=
          app.firestore.Timestamp.fromDate(range_end)
      );
      // Get Deal
      const dealReference = db.collection("/Deals/").doc(doc.data().dealId);
      const dealSnap = await dealReference.get().catch((err) => {
        return response.status(500).json({
          error: err.code,
        });
      });

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
        userName: user.displayName,
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
    const destination = `/Restaurants/${restaurantDocument.slug}/Avatars/${imageToBeUploaded.imageFileName}`;
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

    functions.logger.log("after send. ", fileURL);

    response.json(restaurantDocument);
  });

  // functions.logger.log('enf of file')
  //return request.pipe(bb);
  bb.end(request.rawBody);
  //response.json({});
  //});
};

// History

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
