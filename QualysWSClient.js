/* 
 * Qualys CMDB WS Client - REST WS Client Script Include for the Qualys CMDB Integration.
 * Entry Point for Integration.  Calls other libraries.  Handles WS communication and logging.
 *
 * Fruition Partners - @author: Paul.Senatillaka@FruitionPartners.com
 */

// Fruition SN-Sublime Sync config metadata
// __fileURL = https://cmsenergydev.service-now.com/sys_script_include.do?sys_id=b0779c480f60b100f9fb00dce1050e16
// __fieldName = script
// __authentication = STORED


var QualysWSClient = Class.create();
QualysWSClient.prototype = {
    initialize: function() {
		this._logDebug('Initializing QualysWSClient');
		this.isDebugOn = gs.getProperty("qualys.cmdb.integration.debug", true);
		this.xmlHelper = new XMLHelper();
		this.qualysProcessor = new QualysProcessor();
		this.wsCallCnt = 1;
		this.retryCnt  = 0;
    },

    /*
     * Main Entry Function.  Initiates WS Call to Qualys
     */
    process: function() {
    	try {
			var restMessage = new RESTMessage('Qualys CMDB', 'get');
			restMessage.setStringParameter('chunk_size',gs.getProperty('qualys.cmdb.integration.chunksize', 25));
			restMessage.setStringParameter('qids',gs.getProperty('qualys.cmdb.integration.qids')); //45208,43007,43113,105054,90235,45141
			restMessage.setStringParameter('last_run_date', gs.getProperty('qualys.cmdb.integration.lastrundate', gs.now()));
			var response = null;
			response = restMessage.execute();

			gs.log('Qualys Integration Starting', 'QualysIntegration')
			this.processResponse(response);
		}
		catch (err) {
			gs.logError('QualysWSClient - Unhandled Error during WS Call. Error Msg: ' + err, 'QualysIntegration');
		}

    },

    processResponse: function(respObj) {
		/* Response API Notes
		HTTP response code: response.getStatusCode()
		HTTP response headers: response.getHeaders()
		HTTP response header: response.getHeader(name)
		Response body: response.getBody()
		Error notification: response.haveError()
		Error code: response.getErrorCode()
		Error message: response.getErrorMessage()
		*/

		/* 
		 * HTTP Success Code Received
		 */
		if (respObj && respObj.getStatusCode() == 200) {
			
			//Log our raw inbound SOAP XML
			//this._logDebug('WS Response: ' + respObj.getBody());
			var xmlBodyDoc = new XMLDocument(respObj.getBody());

			//Check if there is some Error Text in Result. When valid data comes back <SIMPLE_RETURN> is not present
			var errorText = xmlBodyDoc.getNodeText('/SIMPLE_RETURN/RESPONSE/TEXT');
			if (errorText) {
				var errorMsg = 'Bad WS Response. Received Error Response: ' + errorText;
				gs.logError(errorMsg, 'QualysIntegration');
				this.sendEmailAlert(errorMsg);
				this.createIncidentAlert(errorMsg);
			}

			//this._logDebug('Parsed Body: ' + xmlBodyDoc.getNode('//HOST_LIST_VM_DETECTION_OUTPUT'));
			var processBody = respObj.getBody() + "";
			this.qualysProcessor.process(processBody.replace(/<!DOCTYPE.*>/g,""));

			//Determine if there is more chunked data. If so recursive call on processResponse()
			var chunkRespObj = this.getNextDataset(xmlBodyDoc);
			if (chunkRespObj) {
				this.processResponse(chunkRespObj);
			} 
			else {
				//Log some Stats
				var runTime = gs.dateDiff(this.qualysProcessor.startTime, gs.nowDateTime(), true);
				var hostCnt = this.qualysProcessor.totalProcessedCnt;
				gs.log('Qualys Integration Finished' 
						+ '\nTotal Run Time (secs): ' + runTime
						+ '\nTotal Hosts Processed: ' + hostCnt
						+ '\nAvg Time per Host (secs): ' + (runTime/hostCnt), 'QualysIntegration');

				//Update Last Run Property
				gs.setProperty('qualys.cmdb.integration.lastrundate', gs.now());
			}
			
		}

		/* 
		 * HTTP Non-Success Code Received
		 */
		else {
			//Check that response object is not null
			if(respObj) {
				gs.logError('QualysWSClient - Non 200 HTTP Code. Received: ' + respObj.getStatusCode()
					+ '\nError Code: ' + respObj.getErrorCode()
					+ '\nError Msg: ' + respObj.getErrorMessage()
					+ '\nResponse Body: ' + respObj.getBody(), 'QualysIntegration');
			}

			var retryWait = gs.getProperty('qualys.cmdb.integration.retrywait', 600000);
			var retryCount = gs.getProperty('qualys.cmdb.integration.retrycount', 3);
			
			gs.logError('QualysWSClient - Bad WS Response. Retrying in (ms): ' + retryWait, 'QualysIntegration');

			//Retry Logic.
			gs.sleep(retryWait);
			if (this.retryCnt++<retryCount) {
				this.process();
			}
			else {
				//Retries Failed.
				var errorMsg = '\nError Code: ' + respObj.getErrorCode() + '\n\nError Message: ' + respObj.getErrorMessage();
				gs.logError('WS Retry failed too many times. Sending out Alert email and Incident. ' + errorMsg, 'QualysIntegration');
				this.sendEmailAlert(errorMsg);
				this.createIncidentAlert(errorMsg);
			}
		}
    },

	/*
     * Helper Function. Additional WS Call to handle Chunking of Data.
     */
    getNextDataset: function(xmlBodyDoc) {

		//Exit early just for testing purposes.
		var wsCallLimit = gs.getProperty('qualys.cmdb.integration.wsCallLimit', 0);
		if (wsCallLimit != 0 && this.wsCallCnt >= wsCallLimit) return;

		//If data was paginated, we have a Warning Node at the end with a <Code>1980></Code> value
		var warningCode = xmlBodyDoc.getNodeText('/HOST_LIST_VM_DETECTION_OUTPUT/RESPONSE/WARNING/CODE');
		
		//Check that response contains pagination code
		if (warningCode == '1980') {
			var nextUrl = xmlBodyDoc.getNodeText('/HOST_LIST_VM_DETECTION_OUTPUT/RESPONSE/WARNING/URL').toString();
			this._logDebug('More data to chunk.  Additional data will be pulled using URL: ' + nextUrl);
			
			var restMessageChunked = new RESTMessage('Qualys CMDB Chunk', 'get');
			restMessageChunked.setRestEndPoint(nextUrl);
			var responseChunked = restMessageChunked.execute();
			this.wsCallCnt++;

			return responseChunked;
		} 
		else {
			this._logDebug('No more chunked data to fetch.');
		}
	},  

	sendEmailAlert: function(errorText) {
		gs.eventQueue("qualys.error.email", null, errorText, null);
	},

	createIncidentAlert: function(errorText) {
		var grInc = new GlideRecord('incident');
		grInc.initialize();
		grInc.short_description = 'Qualys Integration - Fatal Error';
		grInc.work_notes = 'Please have an administrator look into the server logs to determine what is wrong. If needed, REST WS debugging (Refer to SN Wiki) '
		 + 'and Qualys Integration debugging can be turned on and the integration run again to more closely see what the issue was.' + '\n' + errorText;
		grInc.insert();
	},

    /*
     * Debug Function that logs if debugging is on.
     */
    _logDebug: function(msg) {
		if (this.isDebugOn != 'true') {
			return;
		}
		gs.log(msg, "QualysIntegration");
	},

    /*
     * Log WS Response to a special log table.
     */
	_logWS: function(xml, isRequest) {
		if (this.isDebugOn != 'true') {
			return;
		}
		var grXML = new GlideRecord('u_qualys_cmdb_inbound_xml');
		grXML.initialize();
		grXML.u_xml = xml.toString();
		grXML.u_type = isRequest ? "Request" : "Response";
		grXML.insert();

	},

    type: 'QualysWSClient'
}