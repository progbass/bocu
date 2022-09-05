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
const { isDealActive, isDealValid } = require('../utils/deals-utils');
const { RESERVATION_STATUS } = require('../utils/reservations-utils');
const dayjs = require('dayjs');


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
            reservationDate: Timestamp.fromDate(dayjs(request.body.reservationDate).toDate()),
            createdAt: Timestamp.fromDate(dayjs().toDate()),
            cancelledAt: null,
        };

        // Get collection
        const reservationsCollection = collection(db, 'Reservations');

        // Get active deals from current user that match the same restaurant.
        let userReservations = await getDocs(query(
            collection(db, 'Reservations'),
            where('active', '==', true),
            where('customerId', '==', request.user.uid),
            where('restaurantId', '==', request.body.restaurantId),
            where('dealId', '>=', request.body.dealId)
        ));
        let reservation;

        // No more than 1 reservation for the same deal per user.
        if(userReservations.size > 0){
            return response.status(400).json({
                message: 'You already have a reservation for this deal.'
            })
        }

        // Dont allow reservations on past dates.
        if(dayjs(newReservation.reservationDate.toDate()).isBefore(dayjs())){
            return response.status(400).json({
                message: 'Cannot create reservations for a past date.'
            })
        }

        // Get related deal
        const dealRef = doc(db, `Deals/`, request.body.dealId);
        let deal = await getDoc(dealRef);
        if(!deal.exists()){
            return response.status(400).json({
                message: 'Deal not found.'
            }) 
        }
        if(!isDealValid(deal.data())){
            return response.status(400).json({
                error: 'Deal is invalid.'
            }) 
        }
        if(!isDealActive(deal.data())){
            if(deal.get('useCount') >= deal.get('useMax')){
                await updateDoc(dealRef, {active: false});
    
                return response.status(400).json({
                    error: 'Number of reservations exceeded.'
                }) 
            }
            
            return response.status(400).json({
                error: 'Deal has been deactivated.'
            }) 
        }
        if(dayjs(newReservation.reservationDate.toDate()).isAfter(deal.get('expiresAt').toDate())){
            return response.status(400).json({
                error: 'Cannot make a reservation after deal expires.'
            }) 
        }

        // Update deal use count
        await updateDoc(dealRef, {useCount: deal.get('useCount')+1});
        deal = await getDoc(dealRef);

        // Validate max use count and deactivate deal if necessary
        if(deal.get('useCount') >= deal.get('useMax')){
            await updateDoc(dealRef, {active: false});
        }

        // Add new reservation
        const reservationRef = await addDoc(reservationsCollection, newReservation)
        reservation = await getDoc(reservationRef);
        
        // Send confirmation to user
        return response.status(200).json({ 
            ...reservation.data(), 
            id: reservation.id,
            createdAt: reservation.get('createdAt').toDate(),
            reservationDate: reservation.get('reservationDate').toDate()
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