const { generateQrCode } = require("../utils/qr-code");
const { db, app, auth } = require('../utils/admin');
const config = require('../utils/config');
const slugify = require('slugify')
const busboy = require('busboy');
const queryString = require('query-string');
const path = require('path');
const os = require('os');
const fs = require('fs');
//const { auth } = require("firebase-admin");
const cors = require('cors')({origin: true});

//
exports.createRestaurant = (request, response) => {
    // TODO: validate if user exists.

    // TODO: Validate that restaurant exists.

    // Create restaurant.
    const newRestaurantItem = {
        name: request.body.name,
        slug: slugify(request.body.name),
        ...request.body,
        email: request.user.email,
        userId: request.user.uid,
        createdAt: new Date().toISOString(),
        categories: []
    }
    db
        .collection('Restaurants')
        .add(newRestaurantItem)
        .then((documentRef) => {
            // Get new document
            documentRef.get().then(async documentSnapshot => {
                const stg = app.storage();

                // generate QR code
                var QRCode = require('qrcode')
                const qrCode = await QRCode.toDataURL(documentRef.id, {scale: 20, color: {dark: '#E53E3A'}})

                // upload QR to bucket
                const metadata = {
                    public: true,
                    resumable: false,
                    metadata: { contentType: base64MimeType(qrCode) || '' },
                    validation: false
                };

                const bucket = stg.bucket(config.storageBucket);
                const file = bucket.file(`Restaurants/${documentSnapshot.data().slug}/qr_${documentRef.id}-${new Date().getTime()}.png`);
                const base64EncodedString = qrCode.replace(/^data:\w+\/\w+;base64,/, '')
                const fileBuffer = Buffer.from(base64EncodedString, 'base64')
                await file.save(fileBuffer, metadata);

                // register QR URL to database
                await documentRef.update({
                    qrCode: file.publicUrl()
                })

                // return new document
                const updatedDocument = await documentRef.get();
                const responseItem = {
                    id: documentRef.id,
                    ...updatedDocument.data(),
                };
                return response.json(responseItem);
            });
        })
        .catch((err) => {
            console.error(err);
            return response.status(500).json({ error: err.code });
        });
}
exports.editRestaurant = (request, response) => {
    // TODO: Validate that restaurant exists.
    // if(request.body.restaurantId || request.body.createdAt){
    //     response.status(403).json({message: 'Not allowed to edit'});
    // }

    let document = db.collection('Restaurants').doc(`${request.user.restaurantId}`);
    document.update(request.body)
        .then(() => {
            document.get().then(documentSnapshot => {
                response.json(documentSnapshot.data());
            });
        })
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });
}
exports.getRestaurant = (request, response) => {
    let document = db.collection('Restaurants').doc(`${request.params.restaurantId}`);
    document.get()
        .then(doc => {
            response.json({
                ...doc.data()
            });
        })
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });
}

// Create deal
exports.createDeal = (request, response) => {
    // Create deal.
    let newDealItem = {
        userId: request.user.uid,
        restaurantId: request.user.restaurantId,
        createdAt: new Date().toISOString(),
        dealType: request.body.dealType,
        details: request.body.details | '',
        discount: (request.body.discount > 0) ? request.body.discount : 0,
        startsAt: request.body.startsAt,
        expiresAt: request.body.expiresAt,
        include_drinks: request.body.include_drinks | false,
        useMax: request.body.useMax,
        active: true
    }

    // Get restaurant
    let document = db.collection('Restaurants')
		.where("userId", "==", request.user.uid)
		.get()
		.then(data => {

            // No restaurant found.
			if (data.size < 1) {
				return response.status(204).json({
					error: 'Restaurant was not found.'
				});
			}

            // Get last restaurant.
			let restaurant = data.docs[data.size-1];
            newDealItem = {
                restaurantId: restaurant.id,
                ...newDealItem
            }

			//
            db
            .collection('Deals')
            .add(newDealItem)
            .then((documentRef) => {
                console.log(documentRef.id)
                return response.json({
                    id: documentRef.id,
                    restaurantId: 'restaurant.id',
                    ...newDealItem
                }); 
            })
            .catch((err) => {
                console.error(err);
                return response.status(500).json({ error: err.code });
            });
		})
		.catch((err) => {
			return response.status(500).json({
				error: err.code
			});
		});
}
// Get Deals List
exports.getDeals = async (request, response) => {
    // Get Deals collection
    const collection = await db.collection(`Deals`)
        .where('restaurantId', '==', request.user.restaurantId)
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (collection.size > 0) {
        let deals = [];
        collection.forEach((doc) => {
            deals.push({
                id: doc.id,
                ...doc.data()
            });
        });
        return response.json(deals);
    } else {
        return response.status(204).json({
            error: 'No deals were found.'
        });
    }
}
// Get Deal
exports.getDeal = async (request, response) => {
    console.log(request.params.dealId)
    const docRef = db.doc(`Deals/${request.params.dealId}`);
    const docSnap = await docRef.get().catch((err) => {
        return response.status(500).json({
            error: err.code
        });
    });;
    
    if (docSnap.exists) {
        return response.json({
            id: docSnap.id,
            ...docSnap.data()
        });
    } else {
        return response.status(204).json({
            error: 'The deal was not found.'
        });
    }
}
// Delete deal
exports.deleteDeal = async (request, response) => {
    const docRef = db.doc(`Deals/${request.params.dealId}`);
    const docSnap = await docRef.delete().catch((err) => {
        return response.status(500).json({
            error: err.code
        });
    });;
    
    return response.json({
        message: 'Success'
    });
}
// Update deal


// Get Reservation List
exports.getReservationsList = async (request, response) => {
    console.log(request.query)
    let range_init = request.query.range_init;
    let range_end = request.query.range_end;
    const todayDate = new Date();

    // Get Deals collection
    let collectionReference = db.collection(`Reservations`)
        .where('restaurantId', '==', request.user.restaurantId)
        .where('active', '==', true)
        
    // Filter by date range
    if(range_init){
        range_init = app.firestore.Timestamp.fromDate(new Date(request.query.range_init));
    } else {
        range_init = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
    }
    if(range_end){
        range_end = app.firestore.Timestamp.fromDate(new Date(request.query.range_end));
    } else {
        range_end = new Date(todayDate.getFullYear(), todayDate.getMonth()+1, 0);
    }

    // Get collection results
    const collection = await collectionReference
        .where('createdAt', '>', range_init)
        .where('createdAt', '<', range_end)
        .orderBy('createdAt')
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (collection.size > 0) {
        let deals = [];
        for(doc of collection.docs){
            // Get Deal
            const dealReference =  db
                .collection('/Deals/')
                .doc(doc.data().dealId)
            const dealSnap = await dealReference.get()
            .catch((err) => {
                return response.status(500).json({
                    error: err.code
                });
            });

            // Determine status description
            let dealDetails;
            switch(dealSnap.data().dealType){
                case 2:
                    dealDetails = `${dealSnap.data().description}.`;
                    break;
                case 1:
                default:
                    dealDetails = `${(dealSnap.data().discount * 100)}% de descuento.`;
            }

            // Get User
            const userSnap = await auth.getUser(doc.data().customerId);
            const user = userSnap.toJSON();

            // Determine status description
            let statusDescription = "Reservación activa"
            switch(doc.data().status){
                case 2:
                    statusDescription = "Reservación cancelada";
                    break;
                case 3:
                    statusDescription = "Oferta redimida";
                    break;
                case 4:
                    statusDescription = "Esperando cliente";
                    break;
                case 1:
                default:
                    statusDescription = "Reservación activa"
            }
            
            deals.push({
                id: doc.id,
                ...doc.data(),
                statusDescription,
                checkIn: doc.data().checkIn.toDate(),
                createdAt: doc.data().createdAt.toDate(),
                reservationDate: doc.data().reservationDate.toDate(),
                dealType: dealSnap.data().dealType,
                dealDetails,
                userName: user.displayName
            });
        }
        return response.json(deals);
    } else {
        return response.status(204).json({
            error: 'No reservations were found.'
        });
    }
}

// Create Category
exports.createCategory = (request, response) => {
    let newCategoryItem = {
        active: true,
        createdAt: new Date().toISOString(),
        description: request.body.description || '',
        thumbnail: request.body.thumbnail || '',
        name: request.body.name || '',
        slug: slugify(request.body.name) || '',
    }

    // Insert Category
    db
    .collection('Categories')
    .add(newCategoryItem)
    .then((documentRef) => {
        return response.json({
            id: documentRef.id,
            ...newCategoryItem
        }); 
    })
    .catch((err) => {
        console.error(err);
        return response.status(500).json({ error: err.code });
    });
}
// Get Categories
exports.getCategories = async (request, response) => {
    // Get Deals collection
    const collection = await db.collection(`Categories`)
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (collection.size > 0) {
        let categories = [];
        collection.forEach((doc) => {
            categories.push({
                id: doc.id,
                ...doc.data()
            });
        });
        return response.json(categories);
    } else {
        return response.status(204).json({
            error: 'No categories were found.'
        });
    }
}

// Get Menus
exports.getRestaurantMenus = async (request, response) => {
    // Get Menus collection
    const collection = await db.collection(`RestaurantMenus`)
        .where('restaurantId', '==', request.user.restaurantId)
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });;

    // Response
    if (collection.size > 0) {
        let menus = [];
        collection.forEach((doc) => {
            menus.push({
                id: doc.id,
                ...doc.data()
            });
        });
        return response.json(menus);
    } else {
        return response.status(204).json({
            error: 'No menus were found.'
        });
    }
}
// Post Menus
exports.postRestaurantMenu = async (request, response) => {
    // Get restaurant document
    const restaurantDocRef = db.doc(`/Restaurants/${request.user.restaurantId}`);
    const restaurantDocument = (await restaurantDocRef.get()).data();

    // Get Menus
    const menusCollectionRef = db.collection(`RestaurantMenus`)
        .where('restaurantId', '==', request.user.restaurantId)
        .where('active', '==', true)
    const menusCollection = await menusCollectionRef
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });
    // Validate maximum of items
    if(menusCollection.size >= 10){
        return response.status(400).json({ error: 'Limit of items exceeded.' });
    }
    
    // Image config
    const BB = busboy({ headers: request.headers });
    let imageFileName;
    let imageToBeUploaded = {};

    //
    BB.on('file', (name, file, info) => {
        const { filename, encoding, mimeType } = info;
        
        // Validate file format
        if (mimeType !== 'application/pdf' && mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/jpg') {
            return response.status(400).json({ error: 'Wrong file type submited' });
        }
        
        // Name file
        const imageExtension = filename.split('.')[filename.split('.').length - 1];
        imageFileName = `${new Date().toISOString()}.${imageExtension}`;
        const filePath = path.join(os.tmpdir(), imageFileName);
        imageToBeUploaded = { filePath, mimeType, imageFileName };
        file.pipe(fs.createWriteStream(filePath));
    });

    // Delete current image if exists
    deleteImage(imageFileName);

    // When finishing upload, store file on Firebase
    BB.on('finish', async () => {
        const bucket = app.storage().bucket();
        const destination = `Restaurants/${restaurantDocument.slug}/Menus/${imageToBeUploaded.imageFileName}`;
        await bucket.upload(imageToBeUploaded.filePath, {
                resumable: false,
                public: true,
                destination,
                metadata: {
                    metadata: {
                        contentType: imageToBeUploaded.mimetype
                    }
                }
            })
            .catch((error) => {
                console.error(error);
                return response.status(500).json({ error: error.code });
            });

            // Create new registry
            const file = await bucket.file(destination)
            const fileURL = await file.publicUrl();
            const newMenu = {
                restaurantId: restaurantDocument.id,
                active: true,
                createdAt: new Date().toISOString(),
                file: fileURL,
                thumbnail: ''
            }
            await db.collection(`RestaurantMenus`).add(newMenu);

            // Response
            const menusList = [];
            (await menusCollectionRef.get()).forEach(item => {
                menusList.push({id: item.id, ...item.data()})
            })
            return response.json(menusList);
    });
    BB.end(request.rawBody);
}

// Get Gallery
exports.getRestaurantGallery = async (request, response) => {
    // Get Photos collection
    const collection = await db.collection(`RestaurantPhotos`)
        .where('restaurantId', '==', request.user.restaurantId)
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
                id: doc.id,
                ...doc.data()
            });
        });
        return response.json(photos);
    } else {
        return response.status(204).json({
            error: 'No photos were found.'
        });
    }
}
// Post Gallery Photo
exports.postRestaurantPhoto = async (request, response) => {
    // Get restaurant document
    const restaurantDocRef = db.doc(`/Restaurants/${request.user.restaurantId}`);
    const restaurantDocument = (await restaurantDocRef.get()).data();

    // Get Menus
    const photosCollectionRef = db.collection(`RestaurantPhotos`)
        .where('restaurantId', '==', request.user.restaurantId)
        .where('active', '==', true)
    const photosCollection = await photosCollectionRef
        .get()
        .catch((err) => {
            return response.status(500).json({
                error: err.code
            });
        });
    // Validate maximum of items
    if(photosCollection.size >= 10){
        return response.status(400).json({ error: 'Limit of items exceeded.' });
    }
    
    // Image config
    const BB = busboy({ headers: request.headers });
    let imageFileName;
    let imageToBeUploaded = {};

    //
    BB.on('file', (name, file, info) => {
        const { filename, encoding, mimeType } = info;
        
        // Validate file format
        if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/jpg') {
            return response.status(400).json({ error: 'Wrong file type submited' });
        }
        
        // Name file
        const imageExtension = filename.split('.')[filename.split('.').length - 1];
        imageFileName = `${new Date().toISOString()}.${imageExtension}`;
        const filePath = path.join(os.tmpdir(), imageFileName);
        imageToBeUploaded = { filePath, mimeType, imageFileName };
        file.pipe(fs.createWriteStream(filePath));
    });

    // Delete current image if exists
    deleteImage(imageFileName);

    // When finishing upload, store file on Firebase
    BB.on('finish', async () => {
        const bucket = app.storage().bucket();
        const destination = `Restaurants/${restaurantDocument.slug}/Gallery/${imageToBeUploaded.imageFileName}`;
        await bucket.upload(imageToBeUploaded.filePath, {
                resumable: false,
                public: true,
                destination,
                metadata: {
                    metadata: {
                        contentType: imageToBeUploaded.mimetype
                    }
                }
            })
            .catch((error) => {
                console.error(error);
                return response.status(500).json({ error: error.code });
            });

            // Create new registry
            const file = await bucket.file(destination)
            const fileURL = await file.publicUrl();
            const newPhoto = {
                restaurantId: restaurantDocument.id,
                active: true,
                createdAt: new Date().toISOString(),
                file: fileURL,
                thumbnail: ''
            }
            await db.collection(`RestaurantPhotos`).add(newPhoto);

            // Response
            const photosList = [];
            (await photosCollectionRef.get()).forEach(item => {
                photosList.push({id: item.id, ...item.data()})
            })
            return response.json(photosList);
    });
    BB.end(request.rawBody);
}
// Delete photo
deleteImage = (imageName) => {
    const bucket = app.storage().bucket();
    const path = `${imageName}`
    return bucket.file(path).delete()
        .then(() => {
            return
        })
        .catch((error) => {
            return
        })
}

// Upload profile picture
exports.uploadRestaurantProfilePhoto = async (request, response) => {
    cors(request, response, async () => {
        // Get restaurant document
        const restaurantDocRef = await db.doc(`/Restaurants/${request.user.restaurantId}`);
        const restaurantDocument = await (await restaurantDocRef.get()).data();
        
        // BusBoy
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const BB = busboy({ headers: request.headers });

        // Image config
        let imageFileName;
        let imageToBeUploaded = {};

        //
        BB.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;
            
            // Validate file format
            if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/jpg') {
                return response.status(400).json({ error: 'Wrong file type submited' });
            }
            
            // Name file
            const imageExtension = filename.split('.')[filename.split('.').length - 1];
            imageFileName = `${new Date().toISOString()}.${imageExtension}`;
            const filePath = path.join(os.tmpdir(), imageFileName);
            imageToBeUploaded = { filePath, mimeType, imageFileName };
            file.pipe(fs.createWriteStream(filePath));
        });

        // Delete current image if exists
        deleteImage(imageFileName);

        // When finishing upload, store file on Firebase
        BB.on('finish', async () => {
            const bucket = app.storage().bucket();
            const destination = `Restaurants/${restaurantDocument.slug}/Avatars/${imageToBeUploaded.imageFileName}`;
            await bucket.upload(imageToBeUploaded.filePath, {
                    resumable: false,
                    public: true,
                    destination,
                    metadata: {
                        metadata: {
                            contentType: imageToBeUploaded.mimetype
                        }
                    }
                })
                .catch((error) => {
                    console.error(error);
                    return response.status(500).json({ error: error.code });
                });

                // Update restaurant avatar URL
                const file = await bucket.file(destination)
                const fileURL = await file.publicUrl();
                await restaurantDocRef.update({
                    photo: fileURL
                })

                // Response
                return response.json(restaurantDocument);
        });
        BB.end(request.rawBody);
    });
};

// History

// Verify restaurant availability
exports.isRestaurantNameAvailable = (request, response) => {
    // TODO: Validate for case sensitive.
    let document = db.collection('Restaurants')
        .where('name', '==', `${request.params.restaurantName}`)
        .get()
        .then(data => {
            if (data.size) {
                return response.json({
                    available: false
                });
            } else {
                return response.json({
                    available: true
                });
            }
        })
        .catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });
}



const base64MimeType = (encoded) => {
    var result = null;

    if (typeof encoded !== 'string') {
        return result;
    }

    var mime = encoded.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/);

    if (mime && mime.length) {
        result = mime[1];
    }

    return result;
}