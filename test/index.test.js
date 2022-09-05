require("express-async-errors");
const chai = require("chai");
const chaiHttp = require("chai-http");
const { expect, assert } = require("chai");
const admin = require("firebase-admin");
const { firebaseAppConfig } = require("../utils/config");
chai.use(chaiHttp);
chai.expect();

// At the top of test/index.test.js
const test = require("firebase-functions-test")(
  firebaseAppConfig,
  "../service-account-file.json"
);

let userToken = undefined;

// Import the exported function definitions from our functions/index.js file
const app = require("../index");

describe("#indexOf()", function () {
  before(() => {
    // setup the test
  });
  after(() => {
    // tear down the test
    test.cleanup();
  });

  //   it("should return -1 when the value is not present", function () {
  //     assert.equal([1, 2, 3].indexOf(4), -1);
  //   });
  describe("Login", () => {
    it("should contain credentials", async function () {
      let response = await chai.request(app.api).post("/auth/login").send({});
      expect(response.status).to.equal(400);
      expect(response.body).to.have.property("email");
      expect(response.body).to.have.property("password");
    });

    it("should send an error when wrong credentials", async function () {
      let response = await chai
        .request(app.api)
        .post("/auth/login")
        .send({ email: "test@account.com", password: "123456" });
      expect(response.status).to.equal(403);
    });

    it("should succeed if correct credentials.", async function () {
      let response = await chai
        .request(app.api)
        .post("/auth/login")
        .send({ email: "progbass@gmail.com", password: "nomanches" });

      const ejemplo = {
        token: String,
        accessToken: String,
        uid: String,
        email: String,
        emailVerified: Boolean,
        displayName: String,
        photoURL: String,
        phoneNumber: String,
        isAnonymous: Boolean,
        tenantId: String,
        providerData: Array,
        metadata: Object,
        role: String,
      };

      expect(response.status).to.equal(200);
      Object.getOwnPropertyNames(ejemplo).forEach((product) =>
        expect(response.body).to.have.property(product)
      );
      userToken = response.body.token;
    });
  });

  describe("Reservations", () => {
    it("should return the new reservation when OK", async function () {
      let response = await chai.request(app.api)
        .post("/reservations")
        .set({'Authorization': `Bearer ${userToken}`})
        .send({
            "count":2,
            "dealId":"ET09GJeE0e9T3ppEgNhb",
            "restaurantId":"rFNZOGvmz1ASjyJr52Xh",
            "reservationDate":"2022-09-03T16:00:50.653-05:00"
        });
        
        const ReservationInterface = {
            id: String,
            customerId: String,
            restaurantId: String,
            dealId: String,
            status: Number,
            active: Boolean,
            checkIn: Date,
            createdAt: Date,
            cancelledAt: Date,
            reservationDate: Date,
            count: Number
          };
    
          expect(response.status).to.equal(200);
          Object.getOwnPropertyNames(ReservationInterface).forEach((prop) =>
            expect(response.body).to.have.property(prop)
          );
    });
  });
});
