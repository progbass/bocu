const { db, adminAuth } = require('./admin');
const { doc, getDocs, getDoc, query, where, collection } = require('firebase/firestore');

module.exports = async (request, response) => {
	return new Promise(async (resolve, reject) => {
        // Get Auth Id token
        let idToken;
        if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
            idToken = request.headers.authorization.split('Bearer ')[1];
        } else {
            return resolve(undefined);
        }

        try {
            //
            let user = {};
            //auth
            const decodedToken = await adminAuth.verifyIdToken(idToken)
                .catch((err) => {
                    console.error('Error while verifying token', err);
                    return resolve(undefined);
                });
                
            user = decodedToken;
            //const userDBDocument = doc(db, `/Users/`, user.uid);
            const userDBDocument = await getDoc(
                doc(db, `/Users/`, user.uid)
            );
            
            // Set extra properties
            // request.user.id = userDBDocument.id;
            // request.user.username = userDBDocument.data().username;
            // request.user.imageUrl = userDBDocument.data().imageUrl;

            // Get restaurant
            const restaurantQuery = query(
                collection(db, 'Restaurants'),
                where("userId", "==", user.uid)
            );
            const userRestaurants = await getDocs(restaurantQuery)
            user.restaurantId = userRestaurants.docs[0] ? userRestaurants.docs[0].id : null;

            // Return user
            resolve(user);
        } catch(err) {
            console.log (err)
            resolve(undefined);
        };
    });
};