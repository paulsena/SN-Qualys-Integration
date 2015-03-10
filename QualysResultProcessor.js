/*
 * Qualys Result Processor - 
 *
 */

// Fruition SN-Sublime Sync config metadata
// __fileURL = https://cmsenergydev.service-now.com/sys_script_include.do?sys_id=4e73c1cc0f60b100f9fb00dce1050e0f
// __fieldName = script
// __authentication = STORED

var QualysResultParser = Class.create();
QualysResultParser.prototype = {
	initialize: function() {
		this.fieldID = 0;
		this.DataValue = "";
		this.parsedResults = [];
	},

	getParsedResults: function(fieldID, dataValue){
		this.fieldID = fieldID;
		this.dataValue = dataValue;
		this.parsedResults = [];
		switch(this.fieldID){
			case '45208':
				this._getSerialNumber();
				break;
			case '43007':
				this._getMacAddress();
				break;
			case '43113':
				//Not Needed
				break;
			case '105054':
				this._getServerInformation();
				break;
			case '90235':
				this._getWindowsSoftware();
				break;
			case '45141':
				this._getLinuxSoftware();
				break;
			case '45099':
				this._getNetworkAdaptors();
				break;
			default:
				break;
		}
		return this.parsedResults;
	},
	_getSerialNumber:function(){
		var dataArray = this.dataValue.replace("\n"," : ").split(" : ");
		var returnObject = {};
		for(var i = 0; i != dataArray.length; i++){
			var key = dataArray[i].toLowerCase().replace(/\s/g,"_");
			if(i == 0 || (i%2) == 0){
				returnObject[key] = "";
			}else{
				key = dataArray[i - 1].toLowerCase().replace(/\s/g,"_");
				returnObject[key] = dataArray[i];
			}
		}
		this.parsedResults.push(returnObject);
	},
	_getMacAddress:function(){
		var dataArray = this.dataValue.split("\n");
		var headerArray = dataArray[1].split("\t");
		for(var i = 2; i != dataArray.length; i++){
			var currentObject = {};
			var currentArray = dataArray[i].split("\t");
			currentObject[headerArray[0].toLowerCase().replace(/\s/g,"_")] = currentArray[0];
			currentObject[headerArray[1].toLowerCase().replace(/\s/g,"_")] = currentArray[1];
			currentObject[headerArray[2].toLowerCase().replace(/\s/g,"_")] = currentArray[2];
			this.parsedResults.push(currentObject);
		}
	},
	_getServerInformation:function(){
		var dataArray = this.dataValue.split("\n");
		var returnObject = {
			cpu_count:dataArray[0]
		};
		for(var i = 1; i != dataArray.length; i++){
			var currentArray = dataArray[i].split("\t=\t");
			returnObject[currentArray[0].toLowerCase()] = currentArray[1];
		}
		this.parsedResults.push(returnObject);
	},
	_getWindowsSoftware:function(){
		var dataArray = this.dataValue.split("\n");
		var headerArray = dataArray[0].split("\t");
		for(var i = 1; i != dataArray.length; i++){
			var currentArray = dataArray[i].split("\t");
			var returnObject = {};
			for(var x = 0; x != headerArray.length; x++){
				returnObject[headerArray[x].toLowerCase().replace(/\s/g,"_")] = currentArray[x];
			}
			this.parsedResults.push(returnObject);	
		}
	},
	_getLinuxSoftware:function(){
		var dataArray = this.dataValue.split("\n");
		for(var i = 0; i != dataArray.length; i++){
			var currentArray = dataArray[i].split(" ");
			this.parsedResults.push({
				display_name:currentArray[0],
				display_version:currentArray[1],
			});
		}
	},
	_getNetworkAdaptors:function(){
		var dataArray = this.dataValue.split("\n");
		for(var i = 0; i != dataArray.length; i++){
			var returnObject = {};
			var currentArray = dataArray[i].split("\t");
			returnObject['name'] = currentArray[1];
			returnObject['ip_address'] = currentArray[3];
			this.parsedResults.push(returnObject);
		}
	},

	type: 'QualysResultParser'
}