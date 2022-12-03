const { adminDb } = require('../utils/admin');
const { RESERVATION_STATUS } = require('../utils/reservations-utils');
const { 
    RESERVATION_TOLERANCE_MINUTES 
} = require("../utils/app-config");
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

//
exports.updateReservationStatus = async (context) => {
    // Consistent timestamp
    const now = dayjs();
    const nowWithTolerance = now.subtract(RESERVATION_TOLERANCE_MINUTES, 'minutes').toDate();
    
    // Get expired reservations
    const reservationsCollectionRef = adminDb.collection('Reservations')
        .where('reservationDate', '<=', nowWithTolerance)
        .where('active', '==', true);
    const reservationsCollection = await reservationsCollectionRef.get();
    
    // update reservation status
    let docs = reservationsCollection.docs;
    for (let doc of docs) {
        await doc.ref.update({
            active: false,
            status: RESERVATION_STATUS.DEAL_EXPIRED
        });
        await adminDb.collection('UserStrikes').add({
            userId: doc.data().customerId,
            createdAt: now.toDate(),
            reservationId: doc.id,
            discharge: false
        })
    }
    
    //
    return null
};