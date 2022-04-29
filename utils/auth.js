const { app, db } = require('./admin');

module.exports = (request, response, next) => {
	
	// Get Auth Id token
	let idToken;
	if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
		idToken = request.headers.authorization.split('Bearer ')[1];
	} else {
		console.error('No token found');
		return response.status(403).json({ error: 'Unauthorized' });
	}

    //
	app
		.auth()
		.verifyIdToken(idToken)
		.then((decodedToken) => {
			request.user = decodedToken;
			return db.doc(`/Users/${request.user.uid}`).get()
			//db.collection('users').where('userId', '==', request.user.uid).limit(1).get();
		})
		.then((doc) => {
			// Set extra properties
			// request.user.id = doc.docs[0].id;
            // request.user.username = doc.docs[0].data().username;
			// request.user.imageUrl = doc.docs[0].data().imageUrl;

			// Get restaurant
			return db.collection('Restaurants')
				.where("userId", "==", request.user.uid)
				.get()
		})
		.then((doc) => {
			request.user.restaurantId = doc.docs[0] ? doc.docs[0].id : null;
			return next();
		})
		.catch((err) => {
			console.error('Error while verifying token', err);
			return response.status(403).json(err);
		});
};