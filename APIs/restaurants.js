const { db, app, storage } = require('../utils/admin');
const { ref: storageRef, getDownloadURL } = require('firebase/storage');
const { 
    deleteDoc,
    addDoc,
    collection, 
    limit, 
    orderBy, 
    getDocs, 
    getDoc, 
    doc, 
    query, 
    where, 
    updateDoc 
} = require('firebase/firestore'); 
const { 
    hasMissingRequirements, 
    generateQR
} = require('../utils/restaurant-utils');
const getCurrentUser = require("../utils/getCurrentUser");
const slugify = require('slugify')
const dayjs = require("dayjs");
const algoliasearch = require("algoliasearch");

// Config Algolia SDK
const algoliaClient = algoliasearch(
    process.env.ALGOLIA_APP_ID,
    process.env.ALGOLIA_ADMIN_API_KEY
);

// Config
const UTC_OFFSET = -5;
const RESTAURANT_MAX_COUNT = 10;
const RESTAURANT_DEALS_COUNT_MAX = 10;
const DEALS_EXPIRY_OFFSET_MINUTES = 10;
const MAX_SEARCH_RESULTS_HITS = 100;

// GET SINGLE RESTAURANT
exports.getRestaurant = async (request, response) => {
    try {
        let restaurant = await getDoc(
            doc(db, 'Restaurants', `${request.params.restaurantId}`)
        );
        if(!restaurant.exists()){
            return response.status(404).json({
                error: 'Restaurant not found.'
            });
        }
        
        // Get user 'favorite' if logged in
        let isFavorite = false;
        const loggedUser = await getCurrentUser(request, response);        
        if(loggedUser){
            const favoritesCollection = await getDocs(query(
                collection(db, 'UserFavorites'),
                where('userId', '==', loggedUser.uid)
            )).catch((err) => {
                console.error(err);
                return;
            });

            // Is 'favorite' of the user
            favoritesCollection.forEach(favorite => {
                if(favorite.data().restaurantId == restaurant.id){
                    isFavorite = true;
                }
            })
        }
        
        // Get menu items
        const menuCollection = await getDocs(query(
            collection(db, 'RestaurantMenus'),
            where('restaurantId', '==', restaurant.id)
        ));
        const menus = [];
        menuCollection.forEach(m => { menus.push(m.data()) });
 
        // Get restaurant deals
        const dealsCollection = await getDocs(query(
            collection(db, `Deals`),
            where('restaurantId', '==', restaurant.id)
        )).catch((err) => {
            console.error(err);
            return;
        });
        const deals = [];
        dealsCollection.forEach(doc => {
            if(isDealValid(doc.data())){
                deals.push({
                    ...doc.data(),
                    id: doc.id
                })
            }
        })

        // get restaurant raitings list
        const raitingRef = await getDocs(query(
            collection(db, `RestaurantRatings`),
            where('restaurantId', '==', restaurant.id)
        )).catch((err) => {
            console.error(err);
            return;
        });

        // Get raitings average
        let rating = 0;
        const ratingCount = raitingRef.size;
        if(ratingCount){ 
            let counterGroups = {
                'one': 0,
                'two': 0,
                'three': 0,
                'four': 0,
                'five': 0,
            }
            raitingRef.forEach(doc => {
                switch(doc.data().rate){
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
            })
            rating = (
                1 * counterGroups.one
                + 2 * counterGroups.two
                + 3 * counterGroups.three
                + 4 * counterGroups.four
                +5 * counterGroups.five
            ) / (5 * ratingCount);
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
            isFavorite
        });
    } catch (err) {
        console.error(err);
        return response.status(500).json({
            error: err.code
        });
    };  
}
// GET LIST OF RESTAURANTS
exports.getRestaurants = async (request, response) => {
    let restaurantsCollection = await getDocs(query(
        collection(db, 'Restaurants'),
        orderBy('createdAt', 'desc'),
        limit(RESTAURANT_MAX_COUNT)
    )).catch((err) => {
        console.error(err);
        return response.status(500).json({
            error: err.code
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
            const loggedUser = await getCurrentUser(request, response);
            if(loggedUser){
                const favoritesCollection = await getDocs(query(
                    collection(db, `UserFavorites`),
                    where('userId', '==', loggedUser.uid)
                )).catch((err) => {
                    console.error(err);
                    return;
                });
                // Is 'favorite' of the user
                favoritesCollection.forEach(favorite => {
                    if(favorite.data().restaurantId == doc.id){
                        isFavorite;
                    }
                })
            }

            // Get collection
            const raitingRef = await getDocs(query(
                collection(db, `RestaurantRatings`),
                where('restaurantId', '==', doc.id)
            )).catch((err) => {
                console.error(err);
                return;
            });

            // Get raitings average
            let rating = 0;
            const ratingCount = raitingRef.size;
            if(ratingCount){ 
                let counterGroups = {
                    'one': 0,
                    'two': 0,
                    'three': 0,
                    'four': 0,
                    'five': 0,
                }
                raitingRef.forEach(doc => {
                    switch(doc.data().rate){
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
                })
                rating = (
                    1 * counterGroups.one
                    + 2 * counterGroups.two
                    + 3 * counterGroups.three
                    + 4 * counterGroups.four
                    +5 * counterGroups.five
                ) / (5 * ratingCount);
                rating *= 5;
                rating = `${rating} (${ratingCount})`;
            }

            // Get restaurant deals
            const deals = [];
            const dealsCollection = await getDocs(query(
                collection(db, `Deals`),
                where('restaurantId', '==', doc.id)
            )).catch((err) => {
                console.error(err);
                return;
            });
            dealsCollection.forEach(doc => {
                if(isDealValid(doc.data())){
                    deals.push({
                        ...doc.data(),
                        id: doc.id
                    })
                }
            })

            // Return restaurant object
            restaurants.push({
                ...doc.data(),
                id: doc.id,
                isFavorite,
                rating,
                deals
            });
        }

        //
        return response.json(restaurants);
    } else {
        return response.status(204).json({
            error: 'No restaurants were found.'
        });
    }
}
// EDIT RESTAURANT
exports.editRestaurant = async (request, response) => {
    let restaurantReference = doc(db, 'Restaurants', request.params.restaurantId);
    let restaurant = await getDoc(restaurantReference);
  
    // Validate that restaurant exists.
    if(!restaurant.exists){
        response.status(404).json({message: 'User restaurant not found.'});
    }
    
    // Update document.
    await updateDoc(restaurantReference, request.body)
      .catch((err) => {
        console.error(err);
        return response.status(500).json({
          error: err.code,
        });
      });
    
    // Get updated record
    restaurant = await getDoc(restaurantReference);
    let restaurantData = restaurant.data();
  
    // Evaluate if restaurant has
    // the minimum requirements defined by the business
    const hasMinimumRequirements = !hasMissingRequirements(restaurantData);
    
    // Update restaurant 'minimum requirements' property
    await updateDoc(restaurantReference, { hasMinimumRequirements })
      .catch((err) => {
        console.error(err);
        return response.status(500).json({
          error: err.code,
        });
      });
  
    // Get updated record
    restaurant = await getDoc(restaurantReference);
  
    // Response
    response.json({
        ...restaurant.data(),
        id: restaurant.id
    });
};
// DELETE RESTAURANT
exports.deleteRestaurant = async (request, response) => {
    try {
        let restaurant = await deleteDoc(
            doc(db, 'Restaurants', `${request.params.restaurantId}`)
        );

        // Return restaurant document
        return response.status(204).json({ message: 'success' });
    } catch (err) {
        console.error(err);
        return response.status(500).json({
            error: err.code
        });
    };  
}
// CREATE RESTAURANT
exports.createRestaurant = async (request, response) => {
    const restaurantCollection = collection(db, 'Restaurants');
  
    // Validate that restaurant does not exists.
    const existingRestaurant = await getDocs(query(
        restaurantCollection,
        where('name', '==', request.body.name)
    ));
    if(existingRestaurant.size > 0){
        return response.status(409).json({ error: 'Restaurant already exists.' });
    }
  
    // Validate that restaurant does not exists.
    const currentUserRestaurant = await getDocs(query(
        restaurantCollection,
        where('userId', '==', request.user.uid)
    ));
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
    
    const documentRef = await addDoc(
        restaurantCollection,
        newRestaurantItem
    ).catch((err) => {
        console.error(err);
        return response.status(500).json({ error: err.code });
    })

    // Get new document
    const documentSnapshot = await getDoc(documentRef);

    // Evaluate if restaurant has
    // the minimum requirements defined by the business
    const hasMinimumRequirements = !hasMissingRequirements(documentSnapshot.data());

    // Generate QR code
    const qrRef = storageRef(
        storage, 
        `Restaurants/${documentSnapshot.data().slug}/qr_${
            documentRef.id
            }-${new Date().getTime()}.png`
    );
    let publicUrl = await generateQR(
        documentRef.id,
        qrRef
    ); 
    publicUrl = await getDownloadURL(qrRef);

    // Update restaurant info
    await updateDoc( documentRef, {
        qrCode: publicUrl,
        hasMinimumRequirements
    });

    // return new document
    const updatedDocument = await getDoc(documentRef);
    const responseItem = {
        id: documentRef.id,
        ...updatedDocument.data(),
    };
    return response.json(responseItem);
};



exports.getRestaurantDeal = async (request, response) => {
    // Validate that restaurantId exists.
    if(!request.params.restaurantId){
        return response.status(400).json({
            error: 'Restaurant Id is required.'
        })
    }
    
    let document = db.collection('Deals').doc(`${request.params.dealId}`);
    document.get()
        .then(doc => {
            response.json({
                ...doc.data(),
                id: doc.id,
                startsAt: dayjs.unix(doc.data().startsAt.seconds).format('HH:mm'),
                expiresAt: dayjs.unix(doc.data().expiresAt.seconds).format('HH:mm')
            });
        })
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });
}
exports.getRestaurantDeals = async (request, response) => {
    // Validate that restaurantId exists.
    if(!request.params.restaurantId){
        return response.status(400).json({
            error: 'Restaurant Id is required.'
        })
    }
    
    // Buidl query
    let collectionRef = db.collection('Deals')
        .where('restaurantId', '==', request.params.restaurantId)
        .where('expiresAt', '>=', app.firestore.Timestamp.fromDate(dayjs().add(DEALS_EXPIRY_OFFSET_MINUTES, 'minutes').toDate()))
        .where('active', '==', true)
        .limit(RESTAURANT_DEALS_COUNT_MAX);
        
    // Get deals collection
    let collection = await collectionRef.get()
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err
            });
        });

    // Response
    if (collection.size > 0) {
        let restaurants = [];
        collection.forEach((doc) => {
            restaurants.push({
                ...doc.data(),
                id: doc.id,
                startsAt: dayjs.unix(doc.data().startsAt.seconds).utcOffset(UTC_OFFSET).format('HH:mm'),
                expiresAt: dayjs.unix(doc.data().expiresAt.seconds).utcOffset(UTC_OFFSET).format('HH:mm'),
                createdAt: dayjs.unix(doc.data().createdAt.seconds).utcOffset(UTC_OFFSET)
            });
        });
        return response.json(restaurants);
    } else {
        return response.status(200).json([]);
    }
}


// Get Gallery
exports.getRestaurantGallery = async (request, response) => {
    // Validate that restaurantId exists.
    if(!request.params.restaurantId){
        return response.status(400).json({
            error: 'Restaurant id is required.'
        })
    }

    // Get Photos collection
    const collection = await db.collection(`RestaurantPhotos`)
        .where('restaurantId', '==', request.params.restaurantId)
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (collection.size > 0) {
        let photos = [];
        collection.forEach((doc) => {
            photos.push({
                ...doc.data(),
                id: doc.id
            });
        });
        return response.json(photos);
    } else {
        return response.status(204).json({
            error: 'No photos were found.'
        });
    }
}


// Serch (with Algolia)
exports.searchRestaurants = async (request, response) => {
    const algoliaIndex = algoliaClient.initIndex(request.params.indexName);
    const {query = '', ...params} = request.body;
    
    // Query Algolia
    const queryResponse = await algoliaIndex.search(query, {
        ...params,
        //attributesToRetrieve: ['firstname', 'lastname'],
        hitsPerPage: MAX_SEARCH_RESULTS_HITS,
    }).catch(err => {
        console.error(err);
        return response.status(500).json({
            error: err.code
        });
    });
    
    if(queryResponse.hits.length){
        let hits = queryResponse.hits;
        let results = [];

        // Get current user state
        const loggedUser = await getCurrentUser(request, response)
            .catch(err => {
                console.log(err)
            });
        let favoritesCollection = undefined;
        if(loggedUser){
            favoritesCollection = await db.collection(`UserFavorites`)
                .where('userId', '==', loggedUser.uid)
                .get()
                .catch((err) => {
                    console.error(err);
                    return;
                });
        }

        // Configure each item
        for (let doc of hits) {
            // Get user 'favorite' if logged in
            let isFavorite = false;
            if(favoritesCollection){
                // Is 'favorite' of the user
                favoritesCollection.forEach(favorite => {
                    if(favorite.data().restaurantId == doc.objectID){
                        isFavorite = true;
                    }
                })
            }

            // Return restaurant object
            results.push({
                ...doc,
                id: doc.objectID,
                isFavorite,
            });
        }

        //
        return response.json({
            ...queryResponse,
            hits: results
        });
    }
    
    return response.status(204).json({
        error: 'No restaurants were found.'
    });
}


const isDealValid = (deal) => {
    // Config
    let isValid = false;

    // Is active
    if(!deal.active){
        return false;
    }

    // Number of uses
    if(!deal.useCount >= deal.useMax){
        return false;
    }

    // Check expry date
    const now = dayjs();
    if(now > dayjs.unix(deal.expiresAt.seconds).utcOffset(UTC_OFFSET)){
        return false
    }

    //
    return true;
}

