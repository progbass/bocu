const { getMessaging } = require('firebase-admin/messaging');
const { auth, db, adminAuth, admin, adminDb } = require("../admin");
const {
  doc,
  addDoc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  orderBy,
  where,
  query,
  limit,
  Timestamp,
} = require("firebase/firestore");
const dayjs = require("dayjs");
const { getReservationStatusDetails, RESERVATION_STATUS } = require("../reservations-utils");
const { RESERVATION_REMINDER_MINUTES } = require("../app-config");

// Send push notification
exports.sendPushNotification = async (request, response) => {
    const restaurantId = 'lYrDKByESNSaPDyKYMN3';
    let messagingResponse = {};
    const message = {
        data: {
            // score: '850',
            // time: '2:45'
        },
        notification: { 
            title: null, 
            body: null 
        },
        android: {
            notification: {
                sound: 'default'
            }
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default'
                }
            }
        },
        tokens: [],
    };

    console.log('Preparing to send reservation notification to restaurant: ', restaurantId)
    // Get reservation restaurant
    const restaurantRef = adminDb.collection('Restaurants').doc(restaurantId);
    const restaurant = await restaurantRef.get();

    // Get customer tokens
    const customerTokensRef = adminDb.collection('UserDevices')
        .where('userId', '==', restaurant.data().userId);
    const customerTokensCollection = await customerTokensRef.get();

    const customers = [];
    for(let token of customerTokensCollection.docs){
        // Get customer information
        const customerDocument = await adminDb
            .collection('Users')
            .doc(token.data().userId)
            .get(); 
        if(customerDocument.exists){
            customers.push(customerDocument);
        }
    }
    
    for(let customer of customers){
        // Configure message
        message.notification = { 
            title: 'Nueva reservación confirmada', 
            body: `Tienes una reservación en ${restaurant.data().name} a nombre de ${customer.data().firstName} ${customer.data().lastName}. No olvides presentar el código de tu restaurante al cliente.` 
        },
        message.tokens = customerTokensCollection.docs.reduce((previousTokens, device) =>
            {
                let tokensList = previousTokens;
                // console.log(`userId: ${reservation.data().customerId} :: ${device.data().token.substring(0, 5)}`);
                if (device.data().token != '' && device.data().token != undefined){
                    tokensList = [...tokensList, device.data().token];
                }
                return tokensList
            }, []
        );

        // Validate that there are devices to send the notification
        if(!message.tokens.length){
            console.log('No device tokens found skipping notification.');
            continue;
        }

        // Send message to the corresponding devices
        messagingResponse = await getMessaging(admin).sendMulticast(message)
        .then((response) => {
            // Response is a message ID string.
            console.log('Notifications successfully sent.', response);
        })
        .catch((error) => {
            console.log('Error sending notifications.', error);
        });
    }

    //
    return messagingResponse;
    /*

    // // Consistent timestamp
    // const now = dayjs();
    // const nowWithReminderOffset = now.add(RESERVATION_REMINDER_MINUTES, 'minutes').toDate();
    
    // // Get expired reservations
    // const reservationsCollectionRef = adminDb.collection('Reservations')
    //     .where('reservationDate', '<=', nowWithReminderOffset)
    //     .where('active', '==', true)
    //     .where('reminderNotificationSent', '==', false);
    // const reservationsCollection = await reservationsCollectionRef.get();
    
    // const sendReservationReminders = require('../update-reservation-status').sendReservationReminders;
    // await sendReservationReminders(reservationsCollection.docs)

    // return response.json(reservationsCollection.docs);
    
    ////////////////////////////////////////
    const registrationTokens = [
        'fN60-WW8ekkmtvF-1phO84:APA91bG4DsvBfmTYRyEJ92BeTeSgNFab69H5pw2Fm_oyCff2MwCWbUFm7BtBKKwB-ZioqGIjM0MUxabpOFEnHzCjqbvqhTGfhx4MALYydIbFAbikqYylOkYCTWbNcpEQn-j1jK1T0tIy', // Israel Android
        //'cIACvEkDW0FLif6AgsQrEU:APA91bG4DWMq0EuJqmj0kZPyKpLGReB_bi1h_O0Cpdk4tSH2BhjydBJh0DNEF28iOJjvpFERuI9CmbMaYck5fkBrlZnxqXEZYOUZuo0cnJSgyyTlevYvbAAa2C1WOXBgYHXrW1ARohWz', // Andrés 2
    ];
    const message = {
        data: {
            // score: '850',
            // time: '2:45'
        },
        notification: { 
            title: 'No olvides tu reservación', 
            body: `Tienes una reservación en Fabulous Burgers hoy a las 16:30. Recuerda escanear el código del restaurante para disfrutar tu oferta.` 
        },
        android: {
            notification: {
                sound: 'default'
            }
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default'
                }
            }
        },
        tokens: registrationTokens,
    };

    // Send a message to the devices corresponding to the user
    await getMessaging(admin).sendMulticast(message)
    .then((response) => {
        // Response is a message ID string.
        console.log('Successfully sent message:', response);
    })
    .catch((error) => {
        console.log('Error sending message:', error);
    });

    return */
}
