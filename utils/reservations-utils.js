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

exports.getReservationStatusDetails = (reservationId) => {
  let statusDetails;
  switch (reservationId) {
    case 1:
      statusDetails = "Reservación activa";
      break;
    case 2:
      statusDetails = "Reservación cancelada por el usuario";
      break;
    case 3:
      statusDetails = "Reservación en tiempo de tolerancia";
      break;
    case 4:
      statusDetails = "Reservación expirada";
      break;
    case 5:
      statusDetails = "Reservación completada";
      break;
    case 6:
      statusDetails = "Reservación cancelada por el restaurante";
      break;
    case 7:
      statusDetails = "Error con la reservación";
      break;
    case 8:
      statusDetails = "Oferta expirada";
      break;
    case 9:
      statusDetails = "Oferta cancelada";
      break;
    default:
      statusDetails = "Status de la reservación no definido";
  }

  return statusDetails;
}