const { 
    query, 
    doc, 
    addDoc,
    getDoc, 
    getDocs, 
    deleteDoc,
    collection, 
    where, 
    limit,
    Timestamp, 
} = require('firebase/firestore');
const dayjs = require('dayjs');
const { db } = require('../utils/admin');
const { LISTING_CONFIG } = require('../utils/app-config');
const { isDealActive } = require('../utils/deals-utils');


// Add favorite
exports.addFavorite = async (request, response) => {
    // Date settings
    const createdAt = dayjs().unix();

    // New favorite.
    let newFavorite = {
        userId: request.user.uid,
        restaurantId: request.params.restaurantId,
        createdAt: new Timestamp(createdAt),
    }

    // Look for existing records
    const favoritesQuery =  query(
        collection(db, `UserFavorites`),
        where('userId', '==', request.user.uid),
        where('restaurantId', '==', request.params.restaurantId)
    )
    const favoritesDocs = await getDocs(favoritesQuery)
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
            createdAt: dayjs.unix(favorite.data().createdAt.seconds)
        });
    }

    // Add Favorite
    addDoc(
        collection(db, 'UserFavorites'),
        newFavorite
    ).then(async (documentRef) => {
        const doc = await getDoc(documentRef);
        return response.json({
            ...newFavorite,
            id: doc.id,
            createdAt: dayjs.unix(doc.data().createdAt.seconds)
        }); 
    }).catch((err) => {
        console.error(err);
        return response.status(500).json({ error: err.code });
    });
}
// Get Favorites List
exports.getFavorites = async (request, response) => {
    // Build query
    let favoritesQuery = query(
        collection(db, `UserFavorites`),
        where('userId', '==', request.user.uid),
        limit(LISTING_CONFIG.MAX_LIMIT)
    )

    // Get collection
    const FavsCollection = await getDocs(favoritesQuery)
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (FavsCollection.size > 0) {
        let favorites = [];
        for (const fav of FavsCollection.docs) {
            // Get Restaurant
            const restaurantRef = doc(db, `Restaurants`, fav.get('restaurantId'))
            const restaurant =  await getDoc(restaurantRef)
                .catch(err => {});

            // Get collection
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
            const dealsCollection = await getDocs(query(
                collection(db, `Deals`),
                where('restaurantId', '==', restaurant.id)
            )).catch((err) => {
                console.error(err);
                return;
            });

            //
            dealsCollection.forEach(val => {
                if(isDealActive(val.data())){
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
                createdAt: fav.data().createdAt.toDate()
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
    const favoritesQuery =  query(
        collection(db, `UserFavorites`),
        where('userId', '==', request.user.uid),
        where('restaurantId', '==', request.params.restaurantId)
    );
    const favoritesDocs = await getDocs(favoritesQuery)
        .catch((err) => {
            console.error(err);
            return response.status(500).json({ error: err.code });
        });
    
    // Remove documents from collection
    favoritesDocs.forEach(async docRef => {
        await deleteDoc(docRef.ref).catch((err) => {
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
