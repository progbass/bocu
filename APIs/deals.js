const { db, app } = require('../utils/admin');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

// Config.
const RESERVATION_TOLERANCE_MINUTES = 15;
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
exports.redeemDeal = async (request, response) => {
    try {
        // Encontrar el deal con el ID proporcionado en el request.body
        const dealRef = db.doc(`Deals/${request.body.dealId}`);
        let deal = await dealRef.get();
        if(!deal.exists){
            return response.status(400).json({
                error: 'Deal does not exists.'
            });
        }

        // Validate that deal is linked to a restaurant
        if(deal.get('restaurantId') == ""
        || deal.get('restaurantId') == undefined){
            return response.status(400).json({
                error: `Sorry. This deal is not linked to any partner.`
            });
        }

        // // Validate that deal is active
        if(!deal.get('active')){
            // Validate deal does not exceed number of uses
            if(deal.get('useCount') >= deal.get('useMax')){
                await deal.ref.update({active: false})
                return response.status(400).json({
                    error: `Sorry. This deal exceeds the ${deal.get('useMax')} maximum redemption limit.`
                });
            }

            //
            return response.status(400).json({
                error: `Deal has been deactivated by restaurant or admin.`
            });
        }

        // Validate that deal hasn't expired yet
        const NOW = app.firestore.Timestamp.now().toDate();
        const dealExpirationDate = deal.get('expiresAt').toDate();
        const dealExpirationWithTolerance = dayjs(dealExpirationDate).add(RESERVATION_TOLERANCE_MINUTES, 'minute')
        if(dayjs(NOW).isAfter(dealExpirationWithTolerance)){
            return response.status(400).json({
                error: `Deal expired ${dayjs(deal.get('expiresAt').toDate()).tz('America/Mexico_City').format('MMMM D, YYYY, hh:mm')}.`
            })
        }
            
        let reservation;
        // Get reservations made by current user with a matching restaurant ID (Ex. Retrieved from scanning the QR)
        const reservationsCollRef = db.collection(`Reservations`)
            .where('customerId', '==', request.user.uid)
            .where('dealId', '==', deal.id)
            .orderBy('createdAt', 'desc')
            .limit(1);
        const reservationsColl =  await reservationsCollRef.get()
        .catch(err => {
            return response.status(500).json({
                error: err
            });
        });

        // Verificar que la reservación exista.
        if(!reservationsColl.size){
            return response.status(400).json({
                error: 'No reservations found.'
            });
        }

        // Get reservation document
        reservation = reservationsColl.docs[0];

        // Verificar que la reservacion no haya sido concluída
        if(reservation.get('status') == RESERVATION_STATUS.RESERVATION_EXPIRED
        || reservation.get('status') == RESERVATION_STATUS.RESERVATION_FULFILLED
        || reservation.get('status') == RESERVATION_STATUS.USER_CANCELED
        || reservation.get('status') == RESERVATION_STATUS.RESTAURANT_CANCELED){
            return response.status(400).json({
                error: 'Reservation was already redeemed or was canceled.'
            })
        }

        // Verify if deal is active
        if(!reservation.get('active')){
            return response.status(400).json({
                error: 'The reservation is not active anymore.'
            }) 
        }

        // Concluír la reservación (cambio de status)
        await reservation.ref.update({
            status: 4, 
            active: false, 
            checkIn: app.firestore.Timestamp.fromDate(new Date())
        });
        reservation = await reservation.ref.get();

        // Create redemption registry
        const redemptionCollRef =  db.collection('DealRedemptions');
        const redemption = await redemptionCollRef.add({
            createdAt: app.firestore.Timestamp.fromDate(new Date()),
            customerId: request.user.uid,
            dealId: deal.id
        }).catch(err => {
            return response.status(500).json({
                error: err
            });
        });
        const redemptionCount = await redemptionCollRef
            .where('dealId', '==', deal.id)
            .get();

        // Update deal use count
        await dealRef.update({useCount: redemptionCount.size});
        deal = await dealRef.get();

        // Re-validate maximum use count.
        if(deal.get('useCount') >= deal.get('useMax')){
            await deal.ref.update({active: false});
        }

        // Enviar notificación al restaurante.
            // (sms, email, push notification, ui)

        // Send confirmation to user
        return response.status(200).json({ ...reservation.data(), id: reservation.id })
    } catch (err){
        return response.status(500).json({ error: err })
    }
}
exports.findDeal = async (request, response) => {
    //try {
        let reservationsColl, reservationsCollRef, reservation;

        // Get reservations made by current user with a matching restaurant ID (Ex. Retrieved from scanning the QR)
        reservationsCollRef = db.collection('Reservations')
            .where('customerId', '==', request.user.uid)
            .where('restaurantId', '==', request.params.restaurantId)
            .orderBy('createdAt', 'desc')
            .limit(1);
        reservationsColl =  await reservationsCollRef.get()
        .catch(err => {
            return response.status(500).json({
                error: err
            });
        });

        // Validate that there are any reservations
        if(!reservationsColl.size){
            return response.status(204).json({
                error: 'No reservations found.'
            });
        }

        // Get reservation document
        reservation = reservationsColl.docs[0];

        // Validate reservation status
        if(reservation.get('status') == RESERVATION_STATUS.RESERVATION_EXPIRED
        || reservation.get('status') == RESERVATION_STATUS.RESERVATION_FULFILLED
        || reservation.get('status') == RESERVATION_STATUS.USER_CANCELED
        || reservation.get('status') == RESERVATION_STATUS.RESTAURANT_CANCELED){
            return response.status(400).json({
                error: 'Reservation was already redeemed or canceled.'
            });
        }

        // Validate that reservation is active (by admin or restaurant)
        if(reservation.get('active') != true){
            return response.status(400).json({
                error: 'Reservation has been deactivated by the admin.'
            });
        }

        // Validate reservation is 'within today'.
        const NOW = app.firestore.Timestamp.now().toDate();
        const reservationExpiryDate = dayjs(reservation.get('reservationDate'));
        const reservationExpirationWithTolerance = dayjs(reservationExpiryDate).add(RESERVATION_TOLERANCE_MINUTES, 'minute')
        if(dayjs(NOW).isAfter(dayjs(reservationExpirationWithTolerance))){
            return response.status(400).json({
                error: `Reservation expired at ${
                    dayjs(reservationExpiryDate).tz('America/Mexico_City').format('MMMM DD, YYYY, hh:mm')
                }.`
            });
        }
            
        // Encontrar el deal vinculado a esa reservación
        const dealRef = db.doc(`Deals/${reservation.get('dealId')}`)
        let deal = await dealRef.get();
        if(!deal.exists){
            return response.status(400).json({
                error: `Deal does not exists.`
            });
        }


        // Validate that deal is linked to a restaurant
        if(deal.get('restaurantId') == ""
        || deal.get('restaurantId') == undefined){
            return response.status(400).json({
                error: `Sorry. This deal is not linked to any partner.`
            });
        }

        // Validate that deal is active
        if(!deal.get('active')){
            // Validate deal does not exceed number of uses
            if(deal.get('useCount') >= deal.get('useMax')){
                await deal.ref.update({active: false})
                return response.status(400).json({
                    error: `Sorry. This deal exceeds the ${deal.get('useMax')} maximum redemption limit.`
                });
            }

            //
            return response.status(400).json({
                error: `Deal has been deactivated by restaurant or admin.`
            });
        }

        // Validate that deal hasn't expired yet
        const dealExpirationDate = deal.get('expiresAt').toDate();
        const dealExpirationWithTolerance = dayjs(dealExpirationDate).add(RESERVATION_TOLERANCE_MINUTES, 'minute')
        if(dayjs(NOW).isAfter(dealExpirationWithTolerance)){
            return response.status(400).json({
                error: `Deal expired at ${
                    dayjs(dealExpirationDate).tz('America/Mexico_City').format('MMMM DD, YYYY. HH:mm')
                }.`
            });
        }

        
        // Enviar el más reciente deal encontrado
        return response.status(200).json({...deal.data(), id: deal.id})
    // } catch (err){
    //     return response.status(500).json({ error: err })
    // }
}
exports.deleteAllDeals = async (request, response) => {
    try {
        // Get reservation
        const reservationRef = db.collection(`Deals`)
            .where('restaurantId', '==', request.body.restaurantId);
        const reservations = await reservationRef.get();
        
        if(reservations.size){
            for (const reservation of reservations.docs) {
                const test = await reservation.ref.delete();
            }
        }

        // Send confirmation to user
        return response.status(200).json({})
    } catch (err){
        return response.status(500).json({ error: err })
    }
}