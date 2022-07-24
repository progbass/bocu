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
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');
const { get } = require("http");

// Dates configuration.
dayjs.extend(utc);
dayjs.extend(timezone);
const UTC_OFFSET = -5;

// Add favorite
exports.addFavorite = async (request, response) => {
    // Date settings
    const createdAt = dayjs.utc().utcOffset(UTC_OFFSET);

    // New favorite.
    let newFavorite = {
        userId: request.user.uid,
        restaurantId: request.params.restaurantId,
        createdAt: app.firestore.Timestamp.fromDate(createdAt.toDate()),
    }

    // Look for existing records
    const favoritesCol =  db.collection(`UserFavorites`)
        .where('userId', '==', request.user.uid)
        .where('restaurantId', '==', request.params.restaurantId)
    const favoritesDocs = await favoritesCol.get()
        .catch((err) => {
            console.error(err);
            return response.status(500).json({ error: err.code });
        });

    // To avoid duplicates, early return record if it already exists.
    if(favoritesDocs.size){
        const favorite = favoritesDocs.docs[0];
        return response.json({
            ...favorite.data(),
            id: favorite.id,
            createdAt: dayjs.unix(favorite.data().createdAt.seconds).utcOffset(UTC_OFFSET)
        });
    }

    // Add Favorite
    db
    .collection('UserFavorites')
    .add(newFavorite)
    .then(async (documentRef) => {
        const doc = await documentRef.get()
        return response.json({
            ...newFavorite,
            id: doc.id,
            createdAt: dayjs.unix(doc.data().createdAt.seconds).utcOffset(UTC_OFFSET)
        }); 
    })
    .catch((err) => {
        console.error(err);
        return response.status(500).json({ error: err.code });
    });
}
// Get Favorites List
exports.getFavorites = async (request, response) => {
    // Build query
    let collectionReference = db.collection(`UserFavorites`)
        .where('userId', '==', request.user.uid)

    // Get collection
    const collection = await collectionReference.get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (collection.size > 0) {
        let favorites = [];
        for (const fav of collection.docs) {
            // Get Restaurant
            const restaurantRef = db.doc(`Restaurants/${fav.get('restaurantId')}`)
            const restaurant =  await restaurantRef.get()
                .catch(err => {});

            // Get collection
            const raitingRef = await db.collection(`RestaurantRatings`)
                .where('restaurantId', '==', restaurant.id)
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
                raitingRef.forEach(val => {
                    switch(val.data().rate){
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
                .where('restaurantId', '==', restaurant.id)
                .get()
                .catch((err) => {
                    console.error(err);
                    return;
                });
            dealsCollection.forEach(val => {
                if(isDealValid(val.data())){
                    deals.push({
                        ...val.data(),
                        id: val.id
                    })
                }
            })

            favorites.push({
                ...fav.data(),
                ...restaurant.data(),
                isFavorite: true,
                deals,
                rating,
                id: restaurant.id,
                createdAt: dayjs.unix(fav.data().createdAt._seconds).utcOffset(UTC_OFFSET)
            });
        }
        return response.json(favorites);
    } else {
        return response.status(204).json({
            error: 'No favorites found.'
        });
    }
}
// Remove favorite
exports.removeFavorite = async (request, response) => {
    // Look for existing records
    const favoritesCol =  db.collection(`UserFavorites`)
        .where('userId', '==', request.user.uid)
        .where('restaurantId', '==', request.params.restaurantId)
    const favoritesDocs = await favoritesCol.get()
        .catch((err) => {
            console.error(err);
            return response.status(500).json({ error: err.code });
        });
    
    // Remove documents from collection
    favoritesDocs.forEach(async docRef => {
        await docRef.ref.delete().catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;
    })

    // Return response
    return response.json({
        message: 'Favorite was removed successfully.'
    });
}

//
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