class CustomErrorTemplate extends Error {
  constructor(message) {
    super(message);
    // capturing the stack trace keeps the reference to your error class
    Error.captureStackTrace(this, this.constructor);

    // assign the error class name in your custom error (as a shortcut)
    this.name = this.constructor.name;

    // you may also assign additional properties to your error
    this.status = 500;
  }
  statusCode() {
    return this.status;
  }
}


// 
class CustomError extends CustomErrorTemplate {
    constructor(props) {
      const { message = 'Error', status = 500, ...rest } = props
      super(message);
      this.status = status;
    }
  }
exports.CustomError = CustomError;

class ReservationError extends CustomError {
  constructor(props) {
    const { message = 'Error', status = 500, ...rest } = props
    super(message);
    this.status = status;
  }
}
exports.ReservationError = ReservationError;