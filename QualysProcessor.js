/*
 * Qualys Processor - Main class to parse and map Qualys WS Response Data
 *
 * Fruition Partners - @author: Paul.Senatillaka@FruitionPartners.com
 */

// Fruition SN-Sublime Sync config metadata
// __fileURL = https://cmsenergydev.service-now.com/sys_script_include.do?sys_id=4db79c480f60b100f9fb00dce1050e76
// __fieldName = script
// __authentication = STORED

var QualysProcessor = Class.create();
QualysProcessor.prototype = {
    initialize: function() {
        this.isDebugOn = gs.getProperty('qualys.cmdb.integration.debug', true);
        this.processSoftware = gs.getProperty('qualys.cmdb.integration.importSoftware', true);
        this.xmlHelper = new XMLHelper();
        this.resultParser = new QualysResultParser();
        this.totalProcessedCnt = 0;
        this.startTime = gs.nowDateTime();
    },

    /*
     * Main entry point to parse and map WS XML. Called from the WS Client.
     * Loops through each Server entry maps fields and related tables.
     */
    process: function(xmlStr) {

        //Converts XML String to a JS Object. Much easier to parse and iterate over.
        var xmlJS = this.xmlHelper.toObject(xmlStr);
        this._logDebug('QualysProcessor Called. Beginning to process XML Document:\n' + xmlStr);

        // Loop for each Host found in XML
        var hosts = xmlJS.RESPONSE.HOST_LIST.HOST;
        for (var host in hosts) {

            try {

                //Skip PC Hosts from Qualys. We only want Servers
                var currentHost = hosts[host];
                if (currentHost.NETBIOS.slice(0,2).toUpperCase() == 'PC'
				|| currentHost.NETBIOS.slice(0,2).toUpperCase() == 'FW' 
        		|| currentHost.NETBIOS.slice(0,2).toUpperCase() == 'HH'){
                    this._logDebug('Skipping PC Host: ' + currentHost.NETBIOS);
                    continue;
                }

                //Figure out what table to map to
                var snTable = this._getSNTable(currentHost.NETBIOS.toString());

                // sn some run time Statistics
                var runTime = gs.dateDiff(this.startTime, gs.nowDateTime(), true);
                gs.log('Processing Server: ' + currentHost.NETBIOS
                    + '\nTotal Processed: ' + this.totalProcessedCnt
                    + '\nRun Time: ' + runTime, 'QualysIntegration');

                // Parse out Detection XML section specially since it contains uniquely formatted data.
                // Calls out to our QualysResultParser libary for each Detection found.
                var detections = currentHost.DETECTION_LIST.DETECTION;
                var detectionObj = {};
                for (var detecionNumber in detections) {
                    var qid = detections[detecionNumber].QID;
                    var results = detections[detecionNumber].RESULTS;
                    detectionObj[qid] = this.resultParser.getParsedResults(qid, results);
                    //this._logDebug('Detection QID: ' + qid + ' = ' + new JSON().encode(detectionObj[qid]));
                }


                // Build out our Mapping object (Name : Value pairs) for the current Server.
                // Will be passed to a helper function mapFields() later on.
                var fieldMapping = {
                    name: currentHost.NETBIOS,
                    serial_number: this._getDetectionVal(detectionObj['45208'],'system_serial_number'),
                    os_domain: currentHost.DNS.slice(currentHost.DNS.indexOf('.') + 1),
                    os: currentHost.OS,
                    ip_address: currentHost.IP,
                    dns_domain: currentHost.DNS,
                    mac_address: this._getDetectionVal(detectionObj['43007'],'mac_address'),
                    cpu_manufacturer: this._getDetectionVal(detectionObj['105054'],'vendoridentifier'),
                    cpu_type: this._getDetectionVal(detectionObj['105054'], 'processornamestring'),
                    cpu_speed: this._getDetectionVal(detectionObj['105054'], '~mhz'),
                    cpu_count: detectionObj['105054'].length,
                    discovery_source: 'Qualys',
                    u_ce_source: 'Qualys'
                };


                // Call to helper function which Updates/Inserts Server and returns it's sysid
                // Params: Coelesce Fields Array, Table name, Field Mapping Object
                var updatedServerId = this._mapFields(['name','serial'], snTable, fieldMapping);

                // Maintain Related Table - Network Adaptors
                this._maintainNetworkAdaptors(detectionObj, updatedServerId);

                // Maintain Related Table - Installed Software
                if (this.processSoftware) {
                    this._maintainInstalledSoftware(detectionObj, updatedServerId);
                }

                this.totalProcessedCnt++;

            }
            catch (err) {
                gs.logError('QualysProcessor - Unhandled error processing host. Resuming next host. Error Msg: ' + err, 'QualysIntegration');
            }

        }
    },

    _getSNTable: function(netbios) {
        var snTable = '';
        var hostnameCode = netbios.slice(3,6).toUpperCase();
        var grClassMapping = new GlideRecord("u_qualys_class_mapping");
        grClassMapping.addQuery("u_hostname_code", hostnameCode);
        grClassMapping.query();

        if (grClassMapping.next()) {
            snTable = grClassMapping.u_sn_table;
        } 
        //No match found. Default to a table
        else {
            snTable = "cmdb_ci";
        }

        return snTable;
    },

    _maintainNetworkAdaptors: function(detectionObj, serverId) {
        if (detectionObj['45099']) {
            var updatedAdaptors = [];

            //Loop for each Net Adaptor, Build mapping object.
            for (var i = 0; i != detectionObj['45099'].length; i++) {

                //Build Mapping
                var currentAdaptor = detectionObj['45099'][i];

                var adaptorMapping = {
                    name: currentAdaptor.name,
                    ip_address: currentAdaptor.ip_address,
                    cmdb_ci: serverId,
                    discovery_source: 'Qualys',
                    u_ce_source: 'Qualys'
                };

                // Map data for each Adaptor and add sysID to array.
                var adaptorSysID = this._mapFields(['name','ip_address','cmdb_ci'], 'cmdb_ci_network_adapter', adaptorMapping);
                updatedAdaptors.push(adaptorSysID);
            }

            // Maintain Network Adaptors Table
            // Removes any adaptors for current server that wasn't just updated.
            var softwareGR = new GlideRecord('cmdb_ci_network_adapter');
            softwareGR.addQuery('cmdb_ci',serverId);
            softwareGR.addQuery('sys_id','NOT IN',updatedAdaptors.toString());
            softwareGR.deleteMultiple();
        }
    },

    /* 
     * Loops on software array from detection results and maintains Installed Software and Application CI tables
     * For the Installed Software table, any software that wasn't scanned is deleted in order to maintain the table. This funcitons like OOB Discovery and the SCCM Integration
     * Inputs: Takes in detection object and server id.
     */
    _maintainInstalledSoftware: function(detectionObj, serverId) {

        // Looks for Software from two Detection fields (Win or Unix)
        if (detectionObj['90235'] || detectionObj['45141']) {
            var softwareDetection = detectionObj['90235'] ? '90235' : '45141';
            var updatedSoftware = [];

            //Loop for each Software, Build mapping object.
            for (var i = 0; i != detectionObj[softwareDetection].length; i++) {

                //Build Installed Software Mapping
                var currentSoftware = detectionObj[softwareDetection][i];
                var installDate = currentSoftware.install_date ? currentSoftware.install_date : 'Not Found';
                var publisher = currentSoftware.publisher ? currentSoftware.publisher : 'Not Found';

                var softwareMapping = {
                    display_name: currentSoftware.display_name,
                    version: currentSoftware.display_version,
                    install_date: installDate == 'Not Found' ? '' : installDate,
                    publisher: publisher == 'Not Found' ? '' : publisher,
                    installed_on: serverId,
                    discovery_source: 'Qualys'
                };

                // Map data for each Software Install and add sysID to array.
                var softwareSysID = this._mapFields(['display_name','installed_on'], 'cmdb_sam_sw_install', softwareMapping);
                updatedSoftware.push(softwareSysID);

                /* Build Application CI Mapping also
                 * Exclude any software that is a KB Patch. 
                 * Reg Ex Looks for "(KB" followed by 4 to 10 numbers followed by ")" 
                 */
                var regPattern = /\(KB\d{3}.*\)/i;
                if (!regPattern.test(currentSoftware.display_name.toString())) {

                    var applicationCIMapping = {
                        name: currentSoftware.display_name,
                        version: currentSoftware.display_version,
                        discovery_source: 'Qualys',
                        u_ce_source: 'Qualys'
                    }
                    // Map data for each Software CI
                    this._mapFields(['name'], 'cmdb_ci_appl', applicationCIMapping);   
                }
            }
            //End Software Loop

            // Maintain Installed Software Table
            // Removes any software for current server that wasn't just updated.
            var softwareGR = new GlideRecord('cmdb_sam_sw_install');
            softwareGR.addQuery('installed_on',serverId);
            softwareGR.addQuery('sys_id','NOT IN',updatedSoftware.toString());
            softwareGR.deleteMultiple();
        }
    },

    /*
     * Field mapping helper function.
     * Takes in fieldMapping JSON object. Required to have a "coelseceFields", "table", and "records" field in object.
     */
    _mapFields: function(coalesceFields, tableName, mappingData) {

        //Check that coelesce and table fieldnames exist
        if (coalesceFields && tableName && mappingData) {
 
            //Setup Glide Query
            //Loop on each coalesceField and build search query
            var mappingGR = new GlideRecord(tableName);
            for (var i = 0; i != coalesceFields.length; i++) {
                var currentField = coalesceFields[i];
                mappingGR.addQuery(currentField, mappingData[currentField]);
            }
            mappingGR.query();

            //Determine if Update or Insert
            if (mappingGR.hasNext()) {
                //this._logDebug('Update Transaction');
                mappingGR.next();
                for (var key in mappingData) {
                    mappingGR[key] = mappingData[key];
                }
                mappingGR.update();
            } else {
                //this._logDebug('Insert Transaction');
                mappingGR.initialize();
                for (var key in mappingData) {
                    mappingGR[key] = mappingData[key];
                }
                mappingGR.insert();
            }

            //this._logDebug('Processed ' + mappingGR.sys_id + ' in table ' + tableName);
            return mappingGR.sys_id.toString();
        }
    },

    /* 
     * Helper Utility to get values for single row Detection Results
     */
    _getDetectionVal: function(obj, field) {
        if (obj && obj[0] && field) {
            return obj[0][field];
        } else {
            return '';
        }
    },

    /*
     * Debug Function that logs if debugging is on.
     */
    _logDebug: function(msg) {
        if (this.isDebugOn != 'true') {
            return;
        }
        gs.log(msg, 'QualysIntegration');
    },

    type: 'QualysProcessor'
};