const functions = require("firebase-functions");
const { generateQrCode } = require("../utils/qr-code");
const { db, app, auth } = require('../utils/admin');
const config = require('../utils/config');
const slugify = require('slugify')
const busboy = require('busboy');
const queryString = require('query-string');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dayjs = require("dayjs");
const { database } = require("firebase-functions/v1/firestore");
const testjs = dayjs.tz.guess();

// Config
const UTC_OFFSET = -5;
const RESTAURANT_MAX_COUNT = 10;
const RESTAURANT_DEALS_COUNT_MAX = 10;
const DEALS_EXPIRY_OFFSET_MINUTES = 10;

//
exports.getRestaurant = async (request, response) => {
    let document = db.collection('Restaurants').doc(`${request.params.restaurantId}`);
    document.get()
        .then(async doc => {
            // Get menu items
            const menuCollection = await db.collection('RestaurantMenus')
                .where('restaurantId', '==', doc.id)
                .get();
            const menus = [];
            menuCollection.forEach(m => { menus.push(m.data()) });

            // Get restaurant deals
            const dealsCollection = await db.collection(`Deals`)
                .where('restaurantId', '==', doc.id)
                .get()
                .catch((err) => {
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
            const raitingRef = await db.collection(`RestaurantRatings`)
                .where('restaurantId', '==', doc.id)
                .get()
                .catch((err) => {
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
            response.json({
                ...doc.data(),
                id: doc.id,
                menus,
                rating,
                deals
            });
        })
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });
}
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



// Get Restaurants List
exports.getRestaurants = async (request, response) => {
    let collectionRef = db.collection('Restaurants')
        .orderBy('createdAt', 'desc')
        .limit(RESTAURANT_MAX_COUNT);
    let collection = await collectionRef.get()
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });

    // Response
    if (collection.size > 0) {
        // update reservation status
        let docs = collection.docs;
        let restaurants = [];
        for (let doc of docs) {
            // get restaurant raitings list
            if(!doc.get('id')){
                break;
            }

            // Get collection
            const raitingRef = await db.collection(`RestaurantRatings`)
                .where('restaurantId', '==', doc.get('id'))
                .get()
                .catch((err) => {
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
            const dealsCollection = await db.collection(`Deals`)
                .where('restaurantId', '==', doc.get('id'))
                .get()
                .catch((err) => {
                    console.error(err);
                    return;
                });
            dealsCollection.forEach(doc => {
                if(isDealValid(doc.data())){
                    //console.log('asdasd ', isDealValid(doc.data()))
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

