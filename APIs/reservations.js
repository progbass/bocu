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
const functions = require("firebase-functions");
const { db, adminDb } = require('../utils/admin');
const { isDealActive, isDealValid, doesDealHasRedemptionUsage } = require('../utils/deals-utils');
const { RESERVATION_STATUS } = require('../utils/reservations-utils');
const dayjs = require('dayjs');

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
            reservationDate: dayjs(request.body.reservationDate).toDate(),
            createdAt: dayjs().toDate(),
            cancelledAt: null,
        };

        // Get collection
        const reservationsCollection = collection(db, 'Reservations');

        // Try to get a previous reservation from current user linked to the same deal.
        let userReservations = await getDocs(query(
            collection(db, 'Reservations'),
            where('active', '==', true),
            where('customerId', '==', request.user.uid),
            where('restaurantId', '==', request.body.restaurantId),
            where('dealId', '>=', request.body.dealId)
        ));
        let reservation;

        // Users are not allowed to have more than 1 reservation for the same deal.
        if(userReservations.size > 0){
            return response.status(400).json({
                message: 'Ya cuentas con una reservación para esta oferta.'
            })
        }

        // Dont allow reservations on past dates.
        if(dayjs(newReservation.reservationDate).isBefore(dayjs())){
            return response.status(400).json({
                message: 'Imposible crear reservaciones para una fecha pasada.'
            })
        }

        // Get deal
        const dealPath = `Deals/${request.body.dealId}`;
        const dealRef = doc(db, `Deals/`, request.body.dealId);
        let deal = await getDoc(dealRef);
        if(!deal.exists()){
            return response.status(400).json({
                message: 'Oferta no encontrada.'
            }) 
        }
        if(!isDealValid(deal.data())){
            return response.status(400).json({
                message: 'Oferta inválida.'
            }) 
        }
        if(!isDealActive(deal.data())){
            if(!doesDealHasRedemptionUsage(deal.data())){
                await adminDb.doc(dealPath).update({active: false});
    
                return response.status(400).json({
                    message: 'Número de ofertas agotado.'
                }) 
            }
            
            return response.status(400).json({
                message: 'La oferta ha sido desactivada.'
            }) 
        }

        if(!deal.get('isRecurrent')){
            if(dayjs(newReservation.reservationDate).isAfter(deal.get('expiresAt').toDate())){
                return response.status(400).json({
                    message: 'No se puede realizar una reservación. La oferta ha expirado.'
                }) 
            }
        } else {
            // Get deal's recurrent schedules
            const recurrenceSchedules = deal.get('recurrenceSchedules') || [];

            // Check if reservation date is within a valid schedule
            const reservationWeekday = dayjs(newReservation.reservationDate).format('dddd').toLocaleLowerCase();
            const isValidWeekday = recurrenceSchedules.find(schedule => schedule.daySlug === reservationWeekday);
            if(!isValidWeekday){
                return response.status(400).json({
                    message: 'No se puede realizar una reservación. La oferta no es válidad para este día.'
                })
            }

            // Check if reservation schedule is within a valid time range
            const startTimeToday = dayjs()
                .set('hour', dayjs(deal.get('startsAt').toDate()).get('hour'))
                .set('minute', dayjs(deal.get('startsAt').toDate()).get('minute'));
            const expireTimeToday = dayjs()
                .set('hour', dayjs(deal.get('expiresAt').toDate()).get('hour'))
                .set('minute', dayjs(deal.get('expiresAt').toDate()).get('minute'));
            console.log(expireTimeToday.format('dddd HH:mm'), dayjs(newReservation.reservationDate).format('dddd HH:mm'))

            if(dayjs(newReservation.reservationDate).isBefore(startTimeToday)){
                return response.status(400).json({
                    message: 'No se puede realizar una reservación antes del horario de la oferta.'
                }) 
            }
            if(dayjs(newReservation.reservationDate).isAfter(expireTimeToday)){
                return response.status(400).json({
                    message: 'No se puede realizar una reservación después del horario de la oferta.'
                }) 
            }
        }

        // Update deal use count
        await adminDb.doc(dealPath).update({useCount: deal.get('useCount')+1});
        deal = await getDoc(dealRef);

        // Validate max use count and deactivate deal if necessary
        if(!doesDealHasRedemptionUsage(deal.data())){
            await adminDb.doc(dealPath).update({active: false});
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
        return response.status(500).json({ ...err, message: 'Error al crear la reservación.' })
    }
}
exports.cancelReservation = async (request, response) => {
    try {
        // Update and retrieve reservation
        const reservationRef = doc(db, `Reservations`, request.params.reservationId);
        await updateDoc(reservationRef, {
            status: RESERVATION_STATUS.USER_CANCELED, 
            active: false,
            cancelledAt: dayjs().toDate()
        });
        const reservation = await getDoc(reservationRef);

        if(!reservation.exists()){
            return response.status(400).json({
                message: 'Reservación no encontrada.'
            }) 
        }

        // Update deal use count
        const dealRef = adminDb.doc(`Deals/${reservation.get('dealId')}`);
        const deal = await dealRef.get();
        let isDealActive = true;
        let useCount = deal.get('useCount')-1;
        useCount = useCount > 0 ? useCount : 0;
        if(useCount >= deal.get('maxUseCount')){
          isDealActive = false;  
        }
        await dealRef.update({
            useCount,
            active: isDealActive
        })

        // Send confirmation to user
        return response.status(200).json({ ...reservation.data(), id: reservation.id })
    } catch (err){
        functions.logger.error(err);
        return response.status(500).json({ ...err, message: 'Error al cancelar la reservación.' })
    }
}
exports.getReservation = async (request, response) => {
    try {
        let document = await getDoc(
            doc(db, 'Reservations', request.params.reservationId)
        ).catch((err) => {
            console.error(err);
            return response.status(500).json({
                ...err,
                message: 'Error al obtener la reservación.'
            });
        });

        // Get User
        const customer = await getDoc(doc(db, `Users/${document.get('customerId')}`));
        if(!customer.exists){
            return response.status(400).json({
                message: 'Cliente no encontrado.'
            })
        }
        
        // Return reservation document
        return response.status(200).json({
            ...document.data(),
            id: document.id,
            customer: customer.get('email'),
            createdAt: document.get('createdAt').toDate(),
            reservationDate: document.get('reservationDate').toDate(),
            cancelledAt: document.get('cancelledAt') ? document.get('cancelledAt').toDate() : null,
            checkIn: document.get('checkIn') ? document.get('checkIn').toDate() : null,
        });
    } catch (err){
        functions.logger.error(err);
        return response.status(500).json({ ...err, message: 'Error al obtener la reservación.' })
    }
}