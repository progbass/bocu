const { getMultiFactorResolver } = require('firebase/auth');
const { app, db } = require('./admin');

module.exports = async (request, response) => {
	return new Promise((resolve, reject) => {
        // Get Auth Id token
        let idToken;
        if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
            idToken = request.headers.authorization.split('Bearer ')[1];
        } else {
            return resolve(undefined);
        }

        //
        let user = {};
        app
            .auth()
            .verifyIdToken(idToken)
            .then((decodedToken) => {
                user = decodedToken;
                return db.doc(`/Users/${user.uid}`).get()
                //db.collection('users').where('userId', '==', request.user.uid).limit(1).get();
            })
            .then((doc) => {
                // Set extra properties
                // request.user.id = doc.docs[0].id;
                // request.user.username = doc.docs[0].data().username;
                // request.user.imageUrl = doc.docs[0].data().imageUrl;

                // Get restaurant
                return db.collection('Restaurants')
                    .where("userId", "==", user.uid)
                    .get()
            })
            .then((doc) => {
                user.restaurantId = doc.docs[0] ? doc.docs[0].id : null;
                resolve(user);
            })
            .catch((err) => {
                resolve(undefined);
            });
    });
};