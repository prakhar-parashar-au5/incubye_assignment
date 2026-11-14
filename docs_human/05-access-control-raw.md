  1. What can Admin HR see and change?
   Admin HR can see compensation records of all employees.
   They can update salary for any employee. 
   They can see the history of who can see what and when. 
   They can create new hr users and give and change their accesses.




  2. What can Scoped HR see and change?
   They can only see employees within their scope , which is defined by their department and country.
   They can update salaries for employees under them. 
   They can see their change logs. 



  3. Should country and department scopes use AND or OR?
    Country scope use or. An HR can manage multiple departments under multiple contries, but an employee cannot be of more than one department and country. Multiple HRs can have same department or country.
   

  4. What happens when either scope list is empty?
   They see a simple message that you do not have access to see or change anything


  5. Who can change another HR user’s access?
     only Admin HRs.


  6. Should a scoped HR user manage other HR users?
   Admin HRs manages other HR users

  7. What happens to sessions when an HR user becomes inactive?
  Nothing, session will be maintained by cookie or local storage on frontend which carries a JWT token, which has expiry time of 24 hours


  8. Should access changes affect the next request immediately?
    No. 


  9. Do we use passwords, or labelled demo users?
   we will use passwords


  10. What must the audit log record when access changes?
  Which HR changed what, from what to what, at what time. 


Next batch decisions

  1. Cross-product scopes or explicit country/department pairs.

  Cross-product scopes


  2. Immediate rejection after HR deactivation.
  Yes

  3. Immediate effect after access changes.
  Yes

  4. HTTP-only cookie instead of local storage.
  HTTP-only cookie 
  5. Two-hour or 24-hour session.
Two-hour

  6. JWT or database-backed opaque session.
JWT


  7. Password hashing requirement.
  we'll store hash passwords only which will be matched against user types password 