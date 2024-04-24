Qualys Integration for the ServiceNow CMDB.  In this document, we will explain the architecture of the integration and outline the Service Now components that were developed during the implementation in hopes to make maintenance as easy as possible.  The integration was built in a modular, well coded and documented manner to emphasis this.    Some features the integration include: 
A properties page for quick configuration and testing
Custom Report to see the status of newly imported CMDB items.
Custom logging with optional debug logging and import statistics.
Configurable Retry Logic – If the integration fails it can wait and retry again. 
Automatic Email and Incident Ticket alerts when the integration fails.  Since this is a background process, this provides a feedback mechanism when something goes wrong and needs manual intervention.
Paginated WS calls to break up the large data set that comes back into many smaller WS calls.
A “last scan” filter so that each time the integration runs, it filters for only newer Qualys Items with a later scanned date, reducing the load, and allowing for incremental imports.
Modular Code – The JavaScript that drives the integration was broken out into 3 classes that represent different logical layers of functionality.  This promotes code reusability and easier maintenance.
An application section in the SN navigation bar which links admins to all components of the integration for quick reference.


The integration uses the Qualys API v2 to do a one way import into ServiceNow of CMDB data.  The “Host List Detection” API was used from Qualys and more information about it can be found at the following URLs: 
Quick Reference - https://www.qualys.com/docs/qualys-api-v2-quick-reference.pdf
User Guide - https://www.qualys.com/docs/qualys-api-v2-user-guide.pdf

The Integration pulls Asset and related information into SN on a scheduled basis.  Currently the integration is setup to map only Servers (including its related data) and Application Cis but is flexible enough to pull any CMDB information as long as the information is returned from Qualys and the mappings are properly setup in the Integration.


Architecture

The Qualys API is a standard REST Web Service over HTTPS for encryption and uses Basic Auth for Authentication.  A scheduled job was setup to import the data on a reoccurring bases.  This can be configured through the UI to be run on any schedule desired and is the main trigger point for kicking off the integration.  The Scheduled Job calls the Qualys WS Client script include which handles the WS request out to Qualys, in addition to the retry logic and chunking of data .  Once the WS Client script has the piece of chunked data it passes it off to the Qualys Processor.  The processor takes this data and performs all the parsing and mapping of the data into SN.  The data passed from Qualys is XML with Tab Delimited data embedded in a few of the fields in varying column row, row column, etc formats.  Because of this, the Qualys Processor makes a call out to the 3rd JavaScript Include, the Result Processor.  This processor is a helper utility to parse the differently formatted CSV data embedded in the XML fields and returns a standard array of JSON objects for the Qualys Processor to use in its mapping.    

<img width="291" alt="image" src="https://github.com/paulsena/SN-Qualys-Integration/assets/826073/2d2eb64e-6a86-4454-86a2-f0cbc4e10d89">
