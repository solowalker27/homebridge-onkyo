import { API, Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback, Perms} from 'homebridge';

import { OnkyoPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class OnkyoPlatformAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private receiverStates = {
    Power: false,
    Mute: false,
    Volume: 0,
    Input: null
  };
  private eiscp = require('eiscp');
  private info = require('../package.json');
  private RxInputs = {};
  private cmdMap = {
    main: {
      power: 'system-power',
      volume: 'master-volume',
      muting: 'audio-muting',
      input: 'input-selector'
    },
    zone2: {
      power: 'power',
      volume: 'volume',
      muting: 'muting',
      input: 'selector'
    }
  };
  private zone: string;
  private model: string;
  private ip_address: string;

  constructor(
    private readonly platform: OnkyoPlatform,
    private readonly accessory: PlatformAccessory
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
                  .setCharacteristic(this.platform.Characteristic.Manufacturer, accessory.context.device['avrManufacturer'])
                  .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device['model'])
                  .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device['avrSerial'])
                  .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.info.version)
                  .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device['name'])
                  .setCharacteristic(this.platform.Characteristic.ConfiguredName, accessory.context.device['name']);

    // Get/create then set up Television service
    const tvService = this.accessory.getService(this.platform.Service.Television) || this.accessory.addService(this.platform.Service.Television);
    tvService.getCharacteristic(this.platform.Characteristic.Name)
             .setValue(accessory.context.device['name'])
             .setProps({
              perms: [Perms.PAIRED_READ]
             });
		tvService.setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
		tvService.getCharacteristic(this.platform.Characteristic.Active)
			       .on('get', this.getPowerState.bind(this))
			       .on('set', this.setPowerState.bind(this));

		tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
			       .on('set', this.setInputSource.bind(this))
			       .on('get', this.getInputSource.bind(this));
		tvService.getCharacteristic(this.platform.Characteristic.RemoteKey)
			       .on('set', this.remoteKeyPress.bind(this));

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    
    
    // Get/create then set up TelevisionSpeaker service
    const tvSpeakerService = this.accessory.getService(this.platform.Service.TelevisionSpeaker) || this.accessory.addService(this.platform.Service.TelevisionSpeaker);
    tvSpeakerService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device['name'] + ' Volume');
		tvSpeakerService.setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
			              .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);
		tvSpeakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
			              .on('set', this.setVolumeRelative.bind(this));
		tvSpeakerService.getCharacteristic(this.platform.Characteristic.Mute)
			              .on('get', this.getMuteState.bind(this))
			              .on('set', this.setMuteState.bind(this));
		tvSpeakerService.addCharacteristic(this.platform.Characteristic['volume'])
			              .on('get', this.getVolumeState.bind(this))
                    .on('set', this.setVolumeState.bind(this));

    this.createRxInput();

    // Convenience variables
    this.model = this.accessory.context.device['model'];
    this.zone = this.accessory.context.device['zone'];
    this.ip_address = this.accessory.context.device['ip_address'];

    this.eiscp.on('debug', this.eventDebug.bind(this));
		this.eiscp.on('error', this.eventError.bind(this));
		this.eiscp.on('connect', this.eventConnect.bind(this));
		this.eiscp.on('close', this.eventClose.bind(this));
		this.eiscp.on(this.cmdMap[this.zone]['power'], this.eventSystemPower.bind(this));
		this.eiscp.on(this.cmdMap[this.zone]['volume'], this.eventVolume.bind(this));
		this.eiscp.on(this.cmdMap[this.zone]['muting'], this.eventAudioMuting.bind(this));
		this.eiscp.on(this.cmdMap[this.zone]['input'], this.eventInput.bind(this));

    this.eiscp.connect(
			{host: this.ip_address, reconnect: true, model: this.model}
    );

    
    /**
     * Creating multiple services of the same type.
     * 
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     * 
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    // Example: add two "motion sensor" services to the accessory
    const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
      this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
      this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    /**
     * Updating characteristics values asynchronously.
     * 
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     * 
     */
    let motionDetected = false;
    setInterval(() => {
      // EXAMPLE - inverse the trigger
      motionDetected = !motionDetected;

      // push the new value to HomeKit
      motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
      motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);

      this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
      this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    }, 10000);
  }

  createRxInput() {
    // Create the RxInput object for later use.
      const eiscpDataAll = require('eiscp/eiscp-commands.json');
      const inSets: Array<String> = [];
      let inputSet;
  /* eslint guard-for-in: "off" */
      for (const modelset in eiscpDataAll.modelsets) {
        eiscpDataAll.modelsets[modelset].forEach(model => {
          if (model.includes(this.accessory.context.device['model']))
            inSets.push(modelset);
        });
      }
  
      // Get list of commands from eiscpData
      const eiscpData: JSON = eiscpDataAll.commands.main.SLI.values;
      // Create a JSON object for inputs from the eiscpData
      let newobj = '{ "Inputs" : [';
      let exkey;
      for (exkey in eiscpData) {
        let hold = eiscpData[exkey].name.toString();
        if (hold.includes(','))
          hold = hold.substring(0, hold.indexOf(','));
        if (exkey.includes('“') || exkey.includes('“')) {
          exkey = exkey.replace(/\“/g, ''); // eslint-disable-line no-useless-escape
          exkey = exkey.replace(/\”/g, ''); // eslint-disable-line no-useless-escape
        }
  
        if (exkey.includes('UP') || exkey.includes('DOWN') || exkey.includes('QSTN'))
          continue;
  
        // Work around specific bug for “26”
        if (exkey === '“26”')
          exkey = '26';
  
        if (exkey in eiscpData) {
          if ('models' in eiscpData[exkey])
            inputSet = eiscpData[exkey].models;
          else
            continue;
        } else {
          continue;
        }
  
        if (inSets.includes(inputSet))
          newobj = newobj + '{ "code":"' + exkey + '" , "label":"' + hold + '" },';
        else
          continue;
      }
  
      // Drop last comma first
      newobj = newobj.slice(0, -1) + ']}';
      this.RxInputs = JSON.parse(newobj);
    }      

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to turn your device on/off
    this.exampleStates.On = value as boolean;

    this.platform.log.debug('Set Characteristic On ->', value);

    // you must call the callback function
    callback(null);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const isOn = this.exampleStates.On;

    this.platform.log.debug('Get Characteristic On ->', isOn);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOn);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to set the brightness
    this.exampleStates.Brightness = value as number;

    this.platform.log.debug('Set Characteristic Brightness -> ', value);

    // you must call the callback function
    callback(null);
  }

}
