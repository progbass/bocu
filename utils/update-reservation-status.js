const { getMessaging } = require('firebase-admin/messaging');
const { adminDb, admin } = require('../utils/admin');
const { RESERVATION_STATUS } = require('../utils/reservations-utils');
const { 
    RESERVATION_TOLERANCE_MINUTES ,
    RESERVATION_REMINDER_MINUTES
} = require("../utils/app-config");
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');
const { getDocs } = require('firebase/firestore');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

//
exports.updateReservationStatus = async (context) => {
    // Cancel expired reservations
    console.log('canceling expired reservations')
    await cancelExpiredReservations();

    // Get upcoming reservations
    console.log('getting upcoming reservations')
    const upcomingReservations = await getUpcomingReservations();
    // Filter reservations where reminder notification has not been sent
    const reservationsWithoutReminder = upcomingReservations.filter(
        reservation => !reservation.get('reminderNotificationSent')
    );
    // Send reservation reminder (push notification)
    console.log('about to send reminders ',upcomingReservations.length, reservationsWithoutReminder.length);
    await sendReservationReminders(reservationsWithoutReminder);

    console.log('done');
};

// Cancel expired reservations
const cancelExpiredReservations = async () => {
    // Consistent timestamp
    const now = dayjs();
    const nowWithTolerance = now.subtract(RESERVATION_TOLERANCE_MINUTES, 'minutes').toDate();
    
    // Get expired reservations
    const reservationsCollectionRef = adminDb.collection('Reservations')
        .where('reservationDate', '<=', nowWithTolerance)
        .where('active', '==', true);
    const reservationsCollection = await reservationsCollectionRef.get();
    
    // Deactivate reservation
    let reservations = reservationsCollection.docs;
    for (let reservation of reservations) {
        // Update reservation status
        await reservation.ref.update({
            active: false,
            status: RESERVATION_STATUS.DEAL_EXPIRED
        });

        // Add strike to user
        await addStrikeToUser(reservation.data().customerId, reservation.id, now.toDate());
        
    }
    
    //
    return null
}

// Add strike to user
const addStrikeToUser = async (userId, reservationId, date) => {
    await adminDb.collection('UserStrikes').add({
        userId: userId,
        createdAt: date,
        reservationId: reservationId,
        discharge: false
    })
    return;
}

// Get upcoming reservations
const getUpcomingReservations = async () => {
    // Consistent timestamp
    const now = dayjs();
    const nowWithReminderOffset = now.add(RESERVATION_REMINDER_MINUTES, 'minutes').toDate();
    
    // Get expired reservations
    const reservationsCollectionRef = adminDb.collection('Reservations')
        .where('reservationDate', '<=', nowWithReminderOffset)
        .where('active', '==', true)
        .where('reminderNotificationSent', '==', false);
    const reservationsCollection = await reservationsCollectionRef.get();
    
    //
    return reservationsCollection.docs;
}

// Send push notification
const sendReservationReminders = async (reservations = []) => {
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

    // Loop through reservations
    for (let reservation of reservations) {
        console.log('Preparing to send notification to reservation: ', reservation.id)
        // Get reservation restaurant
        const restaurantRef = adminDb.collection('Restaurants').doc(reservation.data().restaurantId);
        const restaurant = await restaurantRef.get();

        // Get customer tokens
        const customerTokensRef = adminDb.collection('UserDevices')
            .where('userId', '==', reservation.data().customerId);
        const customerTokensCollection = await customerTokensRef.get();
        
        // Configure message
        message.notification = { 
            title: 'No olvides tu reservación', 
            body: `Tienes una reservación en ${restaurant.data().name}. Recuerda escanear el código del restaurante para redimir tu oferta.` 
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

        // Update reservation
        await reservation.ref.update({
            reminderNotificationSent: true,
            reminderNotificationSentAt: dayjs().toDate()
        });
    }

    return messagingResponse;
}
exports.sendReservationReminders = sendReservationReminders;