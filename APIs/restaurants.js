const functions = require("firebase-functions");
const { db, storage } = require("../utils/admin");
const {
  MAX_RESTAURANTS_PER_USER,
  SEARCH_CONFIG,
  LISTING_CONFIG,
} = require("../utils/app-config");
const busboy = require("busboy");
const { ref: storageRef, getDownloadURL } = require("firebase/storage");
const {
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  limit,
  orderBy,
  query,
  where,
  Timestamp,
} = require("firebase/firestore");
const {
  hasMissingRequirements,
  generateQR,
  getNewRestaurantObject
} = require("../utils/restaurant-utils");
const { uploadFiletoBucket } = require("../utils/upload-utils");
const { isDealActive, isDealValid } = require("../utils/deals-utils");
const getCurrentUser = require("../utils/getCurrentUser");
const algoliasearch = require("algoliasearch");

// Config Algolia SDK
const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_ADMIN_API_KEY
);

// GET SINGLE RESTAURANT
exports.getRestaurant = async (request, response) => {
  try {
    const currentUser = await getCurrentUser(request, response).catch(() => {
      return null;
    });
    let restaurantId = request.params.restaurantId;

    // Validate if restaurant id is present
    if (!restaurantId) {
      restaurantId = currentUser?.restaurantId;
      if (!restaurantId) {
        return response.status(400).json({
          message: "No se encontró el restaurante.",
        });
      }
    }

    // Try to get restaurant
    let restaurant = await getDoc(doc(db, "Restaurants", `${restaurantId}`));
    if (!restaurant.exists()) {
      return response.status(404).json({
        message: "No se encontró el restaurante.",
      });
    }

    // Get user's 'favorites' if logged in
    let isFavorite = false;
    if (currentUser) {
      const favoritesCollection = await getDocs(
        query(
          collection(db, "UserFavorites"),
          where("userId", "==", currentUser.uid)
        )
      ).catch((err) => {
        console.error(err);
        return;
      });

      // Is 'favorite' of the user
      favoritesCollection.forEach((favorite) => {
        if (favorite.data().restaurantId == restaurant.id) {
          isFavorite = true;
        }
      });
    }

    // Get menu items
    const menuCollection = await getDocs(
      query(
        collection(db, "RestaurantMenus"),
        where("restaurantId", "==", restaurant.id)
      )
    );
    const menus = [];
    menuCollection.forEach((m) => {
      menus.push(m.data());
    });

    // Get restaurant deals
    const dealsCollection = await getDocs(
      query(
        collection(db, `Deals`),
        where("restaurantId", "==", restaurant.id),
        where("active", "==", true)
      )
    ).catch((err) => {
      console.error(err);
      return;
    });
    const deals = [];
    dealsCollection.forEach((doc) => {
      if (isDealActive(doc.data())) {
        deals.push({
          ...doc.data(),
          startsAt: doc.data().startsAt.toDate(),
          expiresAt: doc.data().expiresAt.toDate(),
          createdAt: doc.data().createdAt.toDate(),
          id: doc.id,
        });
      }
    });

    // get restaurant raitings list
    const raitingRef = await getDocs(
      query(
        collection(db, `RestaurantRatings`),
        where("restaurantId", "==", restaurant.id)
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

    // Return restaurant document
    return response.status(200).json({
      ...restaurant.data(),
      id: restaurant.id,
      menus,
      rating,
      deals,
      isFavorite,
    });
  } catch (err) {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: "Ocurrió un error al obtener el restaurante.",
    });
  }
};
// GET LIST OF RESTAURANTS
exports.getRestaurants = async (request, response) => {
  // Filters
  const filters = [];
  if(request.query.verified) {
    const getVerified = request.query.verified == 'true' || false;
     filters.push(where('isApproved', '==', getVerified));
  }
  if(request.query.active) {
    const getActive = request.query.active == 'true' || false;
     filters.push(where('active', '==', getActive));
  }
  if(request.query.complete) {
    const isComplete = request.query.complete == 'true' || false;
     filters.push(where('hasMinimumRequirements', '==', isComplete));
  }
  if(request.query.s) {
    const search = request.query.s;
     filters.push(where('name', '==', search));
  }

  // Get restaurants
  let restaurantsCollection = await getDocs(
    query(
      collection(db, "Restaurants"),
      orderBy("createdAt", "desc"),
      ...filters,
      limit(LISTING_CONFIG.MAX_LIMIT)
    )
  ).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Error al obtener los restaurantes.',
    });
  });

  // Response
  if (restaurantsCollection.size > 0) {
    // update reservation status
    let docs = restaurantsCollection.docs;
    let restaurants = [];
    for (let doc of docs) {
      // Get user 'favorite' if logged in
      let isFavorite = false;
      const currentUser = await getCurrentUser(request, response).catch(() => {
        return null;
      });
      if (currentUser) {
        const favoritesCollection = await getDocs(
          query(
            collection(db, `UserFavorites`),
            where("userId", "==", currentUser.uid)
          )
        ).catch((err) => {
          console.error(err);
          return;
        });
        // Is 'favorite' of the user
        favoritesCollection.forEach((favorite) => {
          if (favorite.data().restaurantId == doc.id) {
            isFavorite;
          }
        });
      }

      // Get collection
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

      // Get restaurant deals
      const deals = await getRestaurantDeals(doc.id);

      // Return restaurant object
      restaurants.push({
        ...doc.data(),
        id: doc.id,
        isFavorite,
        rating,
        deals,
      });
    }

    //
    return response.json(restaurants);
  } else {
    return response.status(204).json({
      message: "No se encontraron restaurantes.",
    });
  }
};
// EDIT RESTAURANT
exports.editRestaurant = async (request, response) => {
  let restaurantReference = doc(db, "Restaurants", request.params.restaurantId);
  let restaurant = await getDoc(restaurantReference);

  // Validate that restaurant exists.
  if (!restaurant.exists()) {
    response.status(404).json({ message: "User restaurant not found." });
  }

  // Update document.
  await updateDoc(restaurantReference, request.body).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Error al actualizar el restaurante.',
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
        message: 'Error al actualizar el restaurante.',
      });
    }
  );

  // Get updated record
  restaurant = await getDoc(restaurantReference);

  // Response
  response.json({
    ...restaurant.data(),
    id: restaurant.id,
  });
};
// DELETE RESTAURANT
exports.deleteRestaurant = async (request, response) => {
  try {
    await deleteDoc(
      doc(db, "Restaurants", `${request.params.restaurantId}`)
    );

    // Return restaurant document
    return response.status(204).json({ message: "success" });
  } catch (err) {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Error al eliminar el restaurante.',
    });
  }
};
// CREATE RESTAURANT
exports.createRestaurant = async (request, response) => {
  try {
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

    if (currentUserRestaurant.size >= MAX_RESTAURANTS_PER_USER) {
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
    const documentRef = await addDoc(
      restaurantCollection,
      newRestaurantItem
    ).catch((err) => {
      console.error(err);
      return response.status(500).json({ ...err, message: 'Ocurrió un error al crear el restaurante.' });
    });

    // Get new document
    const documentSnapshot = await getDoc(documentRef);

    // Evaluate if restaurant has
    // the minimum requirements defined by the business
    const hasMinimumRequirements = !hasMissingRequirements(
      documentSnapshot.data()
    );

    // Generate QR code
    const qrRef = storageRef(
      storage,
      `Restaurants/${documentSnapshot.data().slug}/qr_${
        documentRef.id
      }-${new Date().getTime()}.png`
    );
    let publicUrl = await generateQR(documentRef.id, qrRef);
    publicUrl = await getDownloadURL(qrRef);

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
  } catch (err) {
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al crear el restaurante.',
    });
  }
};

exports.getRestaurantDeal = async (request, response) => {
  // Validate that restaurantId exists.
  if (!request.params.restaurantId) {
    return response.status(400).json({
      message: "El id del restaurante es requerido.",
    });
  }

  let documentReference = doc(db, "Deals", request.params.dealId);
  await getDoc(documentReference)
    .then((doc) => {
      if (!isDealValid(doc.data())) {
        return response.status(404).json({
          message: "Oferta inválida.",
        });
      }

      response.json({
        ...doc.data(),
        id: doc.id,
        startsAt: doc.data().startsAt.toDate(),
        expiresAt: doc.data().expiresAt.toDate(),
        createdAt: doc.data().createdAt.toDate(),
      });
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: 'Ocurrió un error al obtener la oferta.',
      });
    });
};
const getRestaurantDeals = async (restaurantId) => {
  const deals = [];

  //
  return new Promise((resolve, reject) => {
    // Get restaurant deals
    getDocs(
      query(
        collection(db, `Deals`),
        where("restaurantId", "==", restaurantId),
        where("active", "==", true),
        limit(LISTING_CONFIG.MAX_LIMIT)
      )
    )
      .then((dealsCollection) => {
        dealsCollection.forEach((doc) => {
          if (isDealActive(doc.data())) {
            deals.push({
              ...doc.data(),
              startsAt: doc.data().startsAt.toDate(),
              expiresAt: doc.data().expiresAt.toDate(),
              createdAt: doc.data().createdAt.toDate(),
              id: doc.id,
            });
          }
        });

        return resolve(deals);
      })
      .catch((err) => {
        return reject(err);
      });
  });
};
exports.getRestaurantDeals = async (request, response) => {
  // Validate that restaurantId exists.
  if (!request.params.restaurantId) {
    return response.status(400).json({
      message: "El id del restaurante es requerido.",
    });
  }

  // Get deals collection
  let dealsCollection = await getRestaurantDeals(
    request.params.restaurantId
  ).catch((err) => {
    console.error(err);
    return response.status(500).json({
      ...err,
      message: 'Error al obtener las ofertas del restaurante.',
    });
  });

  // Response
  if (dealsCollection.length > 0) {
    return response.json(dealsCollection);
  }
  return response.status(200).json([]);
};

// Get Gallery
exports.getRestaurantGallery = async (request, response) => {
  // Validate that restaurantId exists.
  if (!request.params.restaurantId) {
    return response.status(400).json({
      message: "El id del restaurante es requerido.",
    });
  }

  // Get Photos collection
  const photosCollection = await getDocs(
    query(
      collection(db, `RestaurantPhotos`),
      where("restaurantId", "==", request.params.restaurantId)
    )
  ).catch((err) => {
    return response.status(500).json({
      ...err,
      message: 'Ocurrió un error al obtener la galería del restaurante.',
    });
  });

  // Response
  if (photosCollection.size > 0) {
    let photos = [];
    photosCollection.forEach((doc) => {
      photos.push({
        ...doc.data(),
        id: doc.id,
      });
    });
    return response.json(photos);
  } else {
    return response.status(204).json([]);
  }
};
exports.postRestaurantPhoto = async (request, response) => {
  // Get restaurant document
  const restaurantDocRef = doc(db, `/Restaurants/${request.params.restaurantId}`);
  let resturantRef = await getDoc(restaurantDocRef);
  if (!resturantRef.exists()) {
    response.status(404).json({ message: "No se encontró el restaurante." });
  }
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
      `Restaurants/${restaurantDocument.slug}/Photos/`
    ).then(async (fileURLs) => {
      // Update photo fields
      for(const image of fileURLs){
        switch(image.keyName){
          case 'avatar':
            await updateDoc(restaurantDocRef, {
              avatar: image.fileURL
            });
            break;
          case 'photo':
            await updateDoc(restaurantDocRef, {
              photo: image.fileURL,
            });
            break;
          case 'cover':
            await updateDoc(restaurantDocRef, {
              cover: image.fileURL,
            });
            break;
        }
      }
    }).catch((err) => {
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

// Serch (with Algolia)
exports.searchRestaurants = async (request, response) => {
  // {"query":"","filters":"(categories.slug:Saludables OR categories.slug:Mexicana )","aroundLatLng":"undefined,undefined","aroundRadius":10000}
  const algoliaIndex = algoliaClient.initIndex(request.params.indexName);
  const { query: searchQuery = "" } = request.body;
  const {
    size: userParamSize,
    aroundRadius: userParamRadius,
    p: userParamPage,
    filters: userParamFilters,
    ...params
  } = request.body;
  const filters =  userParamFilters;
  
  // Validate Limit param
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

  // Query Algolia
  const queryResponse = await algoliaIndex
    .search(searchQuery, {
      ...params,
      filters,
      page,
      aroundRadius,
      hitsPerPage,
    })
    .catch((err) => {
      console.error(err);
      return response.status(500).json({
        ...err,
        message: 'Ocurrió un error al realizar la búsqueda.',
      });
    });

  // Early return if there are no results
  if(!queryResponse.hits.length) {
    return response.status(204).json([]);
  }

  // Parse results before returning
  if (queryResponse.hits.length) {
    let hits = queryResponse.hits;
    let results = [];

    // Get current user state
    const currentUser = await getCurrentUser(request, response).catch((err) => {
      console.log(err);
    });
    let favoritesCollection = undefined;
    if (currentUser) {
      favoritesCollection = await getDocs(
        query(
          collection(db, `UserFavorites`),
          where("userId", "==", currentUser.uid)
        )
      ).catch((err) => {
        console.error(err);
        return;
      });
    }

    // Configure each item
    for (let doc of hits) {
      // Get user 'favorites' if logged in
      let isFavorite = false;
      if (favoritesCollection) {
        // Is 'favorite' of the user
        favoritesCollection.forEach((favorite) => {
          if (favorite.data().restaurantId == doc.objectID) {
            isFavorite = true;
          }
        });
      }

      // Format deals list
      const deals = doc.deals.map((deal) => {
        return {
          ...deal,
          createdAt: Timestamp.fromMillis(deal.createdAt._seconds * 1000).toDate(),
          startsAt: Timestamp.fromMillis(deal.startsAt._seconds * 1000).toDate(),
          expiresAt: Timestamp.fromMillis(deal.expiresAt._seconds * 1000).toDate(),
        };
      });

      // Return restaurant object
      results.push({
        ...doc,
        id: doc.objectID,
        isFavorite,
        deals
      });
    }

    //
    return response.json({
      ...queryResponse,
      hits: results,
    });
  }
};
