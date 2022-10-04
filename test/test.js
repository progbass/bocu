const firebase = require("@firebase/testing");
const fs = require("fs");

const projectId = "bocu-b909d";
const firebasePort = require("../../firebase.json").emulators.firestore.port;
const port = firebasePort ? firebasePort : 8080;
const rules = fs.readFileSync("../../firestore.rules", "utf8");
const authData = { uid: "alice", email: "alice@example.com" };

//
function authedApp(auth) {
  return firebase
    .initializeTestApp({
      projectId,
      auth,
    })
    .firestore();
}

beforeEach(async () => {
  await firebase.clearFirestoreData({ projectId });
});
before(async () => {
  await firebase.loadFirestoreRules({ projectId, rules });
});
after(async () => {
  await Promise.all(firebase.apps().map((app) => app.delete()));
});

describe("YOUR TEST SUITE NAME", () => {
  it("require user to log in before doing firestore action", async () => {
    const db = authedApp(null);
    const profile = db.collection("templates").doc("id2");
    await firebase.assertFails(profile.set({ birthday: "January 1" }));
  });

  //
  it("should let anyone read wonder (wonder is the collection name)", async () => {
    const db = authedApp({ uid: "test" });
    const profile = db.collection("wonder").doc("alice");
    await firebase.assertSucceeds(profile.get());
  });

  //
  it("should only let user create their own profile", async () => {
    const db = authedApp({ uid: "alice" });
    await firebase.assertSucceeds(
      db.collection("profile").doc("alice").set({
        birthday: "January 1",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      })
    );

    //
    await firebase.assertFails(
      db.collection("profile").doc("bob").set({
        birthday: "January 1",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      })
    );
  });
});
