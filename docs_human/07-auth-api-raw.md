 # Authentication flow

  ## Browser
    → Next.js server action
    → Express login API
    → Express returns JWT
    → Next.js stores JWT in HTTP-only cookie
    - Next.js own the HTTP-only cookie
    - Express return the JWT only to the Next.js server


## Endpoints

  POST /api/v1/auth/login
  GET  /api/v1/auth/me
  POST /api/v1/auth/logout
  GET  /health
  GET  /api/v1/openapi.json



  Login request

  {
    "email": "meera.iyer@acme.com",
    "password": "demo-password"
  }

  Login response

  {
    "token": "...",
    "expiresAt": "...",
    "user": {
      "id": 1,
      "displayName": "Meera Iyer",
      "email": "meera.iyer@acme.com",
      "role": "ADMIN"
    }
  }

 The login response include the user summary?

  Current-user response

  The /me response can include:

  id
  display name
  email
  role
  status
  country scopes
  department scopes
  session expiry

  /me include all current scopes?

  ## Login errors

  Recommended public message:

  Email or password is incorrect. One generic login error

  Use the same message for:

  - Unknown email.
  - Wrong password.
  - Inactive HR user.
   


## Request validation

 We will use zod. TypeScript checks our code. Zod checks data received at runtime.


## Rate limit rule:

  Limit five failed login attempts for one normalized email and caller network key in 15 minutes.

  The limiter hashes the normalized email. It must not store or log the plain email.

  This prevents failed attempts for one account from blocking every user when Next.js calls Express.


 ## Demo credentials

  The login screen should show the two demo email addresses.

   Different public passwords for Meera and Rohan.
   Show credentials on the login page.

  I recommend one shared demo password shown on the login page and in the README. It is synthetic demo access, not a private account.



##  API contract 


  - Zod schemas define runtime validation.
  - The backend generates OpenAPI.
  - The frontend later generates API types from OpenAPI.
  - We do not maintain separate handwritten frontend response types.


 ## CORS

  The browser will call Next.js.
  Next.js server code will call Express.
  The browser does not need direct access to Express. 
  No browser CORS access by default.

 ## Logs

  Write what must not appear in logs.
  passwords
  password hashes
  JWTs
  cookies
  salary values
  database URLs
  request bodies

 ## Logout

  - Revoke the database session.
  - Return success if the session was already revoked.
  - Next.js deletes its cookie.
