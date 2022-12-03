const { db, auth } = require("./admin");
const {
  signInWithCustomToken,
  onAuthStateChanged,
  confirmPasswordReset,
} = require("firebase/auth");
const {
  doc,
  getDocs,
  getDoc,
  query,
  where,
  collection,
} = require("firebase/firestore");
const { getCurrentUser } = require("./auth");

module.exports = async (request, response) => {
  return new Promise((resolve, reject) => {
    // Verify that token is present
	if (!request.headers.authorization && !request.headers.authorization.startsWith('Bearer ')) {
		console.error('No token found');
		return response.status(403).json({ message: 'Usuario no autorizado.' });
	}
	
	// Get token
	const idToken = request.headers.authorization.split('Bearer ')[1];

    //
    try {
        const user = getCurrentUser(auth, idToken);
        resolve(user);
    } catch(err) {
        reject(err);
      }
    });

    // Get Auth Id token
    /* let idToken;
        if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
            idToken = request.headers.authorization.split('Bearer ')[1];
        } else {
            return resolve(undefined);
        }

        try {
            //
            let user = {};
            //auth
            const decodedToken = await signInWithCustomToken(auth, idToken) // await adminAuth.verifyIdToken(idToken)
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
  });*/
};
