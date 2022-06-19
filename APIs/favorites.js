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
        collection.forEach((doc) => {
            favorites.push({
                ...doc.data(),
                id: doc.id,
                createdAt: dayjs.unix(doc.data().createdAt._seconds).utcOffset(UTC_OFFSET)
            });
        });
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