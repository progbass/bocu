const { CustomError } = require("./CustomError");

// Reservation Status
const RESERVATION_STATUS = {
    AWAITING_CUSTOMER: 1,
    USER_CANCELED: 2,
    TOLERANCE_TIME: 3,
    RESERVATION_EXPIRED: 4, 
    COMPLETED: 5,
    RESTAURANT_CANCELED: 6,
    OTHER: 7,
    DEAL_EXPIRED: 8,
    DEAL_CANCELED: 9
}
exports.RESERVATION_STATUS = RESERVATION_STATUS;
exports.RESERVATION_TOLERANCE_MINUTES = 15;
exports.isReservationActive = async(reservation) => {
    if (
        reservation.status == RESERVATION_STATUS.RESERVATION_EXPIRED ||
        reservation.status == RESERVATION_STATUS.COMPLETED ||
        reservation.status == RESERVATION_STATUS.USER_CANCELED ||
        reservation.status == RESERVATION_STATUS.RESTAURANT_CANCELED
      ) {
        throw new CustomError({
            status: 400, 
            message: "Reservation was already redeemed or was canceled.",
        });
      }
}
exports.isReservationValid = async(reservation) => {
    if (
        reservation.status == RESERVATION_STATUS.RESERVATION_EXPIRED ||
        reservation.status == RESERVATION_STATUS.COMPLETED ||
        reservation.status == RESERVATION_STATUS.USER_CANCELED ||
        reservation.status == RESERVATION_STATUS.RESTAURANT_CANCELED
      ) {
        throw new CustomError({
            status: 400, 
            message: "Reservation was already redeemed or was canceled.",
        });
      }
}
