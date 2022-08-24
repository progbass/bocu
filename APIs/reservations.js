const { 
    doc,
    addDoc, 
    getDoc, 
    getDocs, 
    query, 
    collection, 
    updateDoc,
    Timestamp,
    where,
    limit,
    orderBy
} = require('firebase/firestore');
const { db, app } = require('../utils/admin');
const { RESERVATION_STATUS } = require('../utils/reservations-utils');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

// Config.
const UTC_OFFSET = -5;

// Methods
exports.createReservation = async (request, response) => {
    try {
        // Create reservation prototype.
        const newReservation = {
            active: true,
            status: RESERVATION_STATUS.AWAITING_CUSTOMER,
            checkIn: null,
            count: request.body.count,
            customerId: request.user.uid,
            dealId: request.body.dealId,
            restaurantId: request.body.restaurantId,
            reservationDate: Timestamp.fromDate(dayjs.utc(request.body.reservationDate).utcOffset(UTC_OFFSET).toDate()),
            createdAt: Timestamp.fromDate(dayjs.utc().utcOffset(10).toDate()),
            cancelledAt: null,
        };

        // Get collection
        const reservationsCollection = collection(db, 'Reservations');

        // ToDo: Invalidar el resto de las reservaciones del usuario?

        // Get related deal
        const dealRef = doc(db, `Deals/`, request.body.dealId);
        let deal = await getDoc(dealRef);
        if(!deal.exists()){
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
            await updateDoc(dealRef, {active: false});

            return response.status(400).json({
                error: 'Number of reservations exceeded.'
            }) 
        }
        // Update deal use count
        await updateDoc(dealRef, {useCount: deal.get('useCount')+1});
        deal = await getDoc(dealRef);
        // Update
        if(deal.get('useCount') >= deal.get('useMax')){
            await updateDoc(dealRef, {active: false});
        }


        // Add new reservation
        const reservationRef = await addDoc(reservationsCollection, newReservation)
        const reservation = await getDoc(reservationRef);
        
        // Send confirmation to user
        return response.status(200).json({ 
            ...reservation.data(), 
            id: reservation.id,
            createdAt: dayjs(dayjs.unix(reservation.data().createdAt.seconds)).tz('America/Mexico_City', false).toDate(),
            reservationDate: dayjs.unix(reservation.get('reservationDate').seconds)
        })
    } catch (err){
        console.log(err)
        return response.status(500).json({ error: err })
    }
}
exports.cancelReservation = async (request, response) => {
    try {
        // Get reservation
        const reservationRef = doc(db, `Reservations`, request.params.reservationId);
        await updateDoc(reservationRef, {
            status: RESERVATION_STATUS.USER_CANCELED, 
            active: false,
            cancelledAt: Timestamp.fromDate(new Date())
        });
        const reservation = await getDoc(reservationRef);

        if(!reservation.exists()){
            return response.status(400).json({
                error: 'Reservation not found.'
            }) 
        }

        // Update deal use count
        const dealRef = doc(db, `Deals`, reservation.get('dealId'));
        const deal = await getDoc(dealRef);
        let useCount = deal.get('useCount')-1;
        useCount = useCount > 0 ? useCount : 0;
        await updateDoc(dealRef, {useCount})

        // Send confirmation to user
        return response.status(200).json({ ...reservation.data(), id: reservation.id })
    } catch (err){
        return response.status(500).json({ error: err })
    }
}
exports.getReservation = async (request, response) => {
    try {
        let document = await getDoc(
            doc(db, 'Reservations', request.params.reservationId)
        ).catch((err) => {
            console.error(err);
            return response.status(500).json({
                error: err.code
            });
        });

        // Get User
        //const customerSnap = await adminAuth.getUser(document.data().customerId);
        const customer = request.user; //customerSnap.toJSON();
        
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