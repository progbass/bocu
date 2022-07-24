const { db, app } = require('../utils/admin');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

// Config.
const UTC_OFFSET = -5;
const RESERVATION_STATUS = {
    AWAITING_CUSTOMER: 1,
    USER_CANCELED: 2,
    TOLERANCE_TIME: 3,
    RESERVATION_EXPIRED: 4, 
    RESERVATION_FULFILLED: 5,
    RESTAURANT_CANCELED: 6,
    OTHER: 7,
    DEAL_EXPIRED: 8,
    DEAL_CANCELED: 9
  }

// Methods
exports.createReservation = async (request, response) => {
    try {
        // Create reservation prototype.
        const newReservation = {
            active: true,
            status: RESERVATION_STATUS.AWAITING_CUSTOMER,
            checkIn: null,
            count: request.body.count,
            customerId: request.body.customerId,
            dealId: request.body.dealId,
            restaurantId: request.body.restaurantId,
            reservationDate: app.firestore.Timestamp.fromDate(dayjs.utc(request.body.reservationDate).utcOffset(UTC_OFFSET).toDate()),
            createdAt: app.firestore.Timestamp.fromDate(dayjs.utc().utcOffset(10).toDate()),
            cancelledAt: null,
        };

        console.log(newReservation.createdAt)

        // Get collection
        const reservationsCollection = db.collection('Reservations');

        // ToDo: Invalidar el resto de las reservaciones del usuario?

        // Get related deal
        const dealRef = db.doc(`Deals/${request.body.dealId}`);
        let deal = await dealRef.get();
        if(!deal.exists){
            return response.status(400).json({
                error: 'Deal not found.'
            }) 
        }
        if(!deal.get('active')){
            return response.status(400).json({
                error: 'Deal has been deactivated.'
            }) 
        }
        // Validate that there are still 'use counts' avaliable for the deal.
        if(deal.get('useCount') >= deal.get('useMax')){
            await dealRef.update({active: false});

            return response.status(400).json({
                error: 'Number of reservations exceeded.'
            }) 
        }
        // Update deal use count
        await dealRef.update({useCount: deal.get('useCount')+1});
        deal = await dealRef.get();
        // Update
        if(deal.get('useCount') >= deal.get('useMax')){
            await dealRef.update({active: false});
        }


        // Add new reservation
        const reservation = await (await reservationsCollection.add(newReservation)).get();
        
        // Send confirmation to user
        return response.status(200).json({ 
            ...reservation.data(), 
            id: reservation.id,
            createdAt: dayjs(dayjs.unix(reservation.data().createdAt.seconds)).tz('America/Mexico_City', false).toDate(),
            reservationDate: dayjs.unix(reservation.get('reservationDate').seconds)
        })
    } catch (err){
        return response.status(500).json({ error: err })
    }
}
exports.cancelReservation = async (request, response) => {
    try {
        // Get reservation
        const reservationRef = db.doc(`Reservations/${request.params.reservationId}`);
        await reservationRef.update({
            status: RESERVATION_STATUS.USER_CANCELED, 
            active: false,
            cancelledAt: app.firestore.Timestamp.fromDate(new Date())
        });
        const reservation = await reservationRef.get();

        if(!reservation.exists){
            return response.status(400).json({
                error: 'Reservation not found.'
            }) 
        }

        // Update deal use count
        const dealRef = db.doc(`Deals/${reservation.get('dealId')}`);
        const deal = await dealRef.get();
        let useCount = deal.get('useCount')-1;
        useCount = useCount > 0 ? useCount : 0;
        await dealRef.update({useCount})

        // Send confirmation to user
        return response.status(200).json({ ...reservation.data(), id: reservation.id })
    } catch (err){
        return response.status(500).json({ error: err })
    }
}
exports.getReservation = async (request, response) => {
    try {
        let document = await db.collection('Reservations')
            .doc(`${request.params.reservationId}`)
            .get()
            .catch((err) => {
                console.error(err);
                return response.status(500).json({
                    error: err.code
                });
            });

        // Get User
        const customerSnap = await auth.getUser(document.data().customerId);
        const customer = customerSnap.toJSON();
        
        // Return reservation document
        return response.status(200).json({
            ...document.data(),
            id: document.id,
            customer: customer.email
        });
    } catch (err){
        return response.status(500).json({ error: err })
    }
}