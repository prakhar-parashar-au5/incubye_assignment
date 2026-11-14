# Generator test cases

1. It creates exactly 10,000 employees.
2. Every employee ID is unique.
3. Every email address is unique.
4. Salary is always upto 2 decimal places, and does not exceeds 4cr INR, cannot be less than 3L 
5. Salary cannot exceed - 
For a junior -  10L INR
For mid-level - 40L INR
6. Enum columns (pay_frequency, Departments) should be tested against only possible options  - Allowed values in source-workbook 
7. Required values should be tested against, empty string, null, or gibbrish 
8. Reject a missing required value.