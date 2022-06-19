const { db, app } = require('../utils/admin');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

// Config
const RESERVATION_TOLERANCE_MINUTES = 15;

//
exports.updateReservationStatus = async (request, response, next) => {
        // Consistent timestamp
        const now = dayjs();
        const nowWithTolerance = now.subtract(RESERVATION_TOLERANCE_MINUTES, 'minutes').toDate();
        
        // Get expired reservations
        const reservationsCollectionRef = db.collection('Reservations')
            .where('reservationDate', '<=', nowWithTolerance)
            .where('active', '==', true);
        const reservationsCollection = await reservationsCollectionRef.get();
        
        // update reservation status
        let docs = reservationsCollection.docs;
        for (let doc of docs) {
            await doc.ref.update({active: false});
        }
        
        //
        return
};