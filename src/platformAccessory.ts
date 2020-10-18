import { Logger, Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback, Perms} from 'homebridge';

import { OnkyoPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class OnkyoPlatformAccessory {
  // private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private tvService: Service;
  private tvSpeakerService: Service;
  private receiverState = {
    Power: false,
    Mute: false,
    Volume: 0,
    Input: 0
  };
  private eiscp = require('eiscp');
  private info = require('../package.json');
  private RxInputs = {
    Inputs: [
      {
        label: "",
        code: ""
      }
    ]
  };
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
  private buttons: object = {};
  private zone: string;
  private model: string;
  private ip_address: string;

  constructor(
    private readonly platform: OnkyoPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly log: Logger
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
    this.tvService = this.accessory.getService(this.platform.Service.Television) || this.accessory.addService(this.platform.Service.Television);
    this.tvService.getCharacteristic(this.platform.Characteristic.Name)
                  .setValue(accessory.context.device['name'])
                  .setProps({
                    perms: [Perms.PAIRED_READ]
                  });
		this.tvService.setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
		this.tvService.getCharacteristic(this.platform.Characteristic.Active)
			            .on('set', this.setPowerState.bind(this));

		this.tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
			            .on('set', this.setInputSource.bind(this));
		this.tvService.getCharacteristic(this.platform.Characteristic.RemoteKey)
			            .on('set', this.remoteKeyPress.bind(this));

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    
    
    // Get/create then set up TelevisionSpeaker service
    this.tvSpeakerService = this.accessory.getService(this.platform.Service.TelevisionSpeaker) || this.accessory.addService(this.platform.Service.TelevisionSpeaker);
    this.tvSpeakerService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device['name'] + ' Volume');
		this.tvSpeakerService.setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
			                   .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);
		this.tvSpeakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
			                   .on('set', this.setVolumeRelative.bind(this));
		this.tvSpeakerService.getCharacteristic(this.platform.Characteristic.Mute)
			                   .on('set', this.setMuteState.bind(this));
		this.tvSpeakerService.addCharacteristic(this.platform.Characteristic['volume'])
                         .on('set', this.setVolumeState.bind(this));

    this.buttons = {
      [this.platform.Characteristic.RemoteKey.REWIND]: 'rew',
      [this.platform.Characteristic.RemoteKey.FAST_FORWARD]: 'ff',
      [this.platform.Characteristic.RemoteKey.NEXT_TRACK]: 'skip-f',
      [this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK]: 'skip-r',
      [this.platform.Characteristic.RemoteKey.ARROW_UP]: 'up', // 4
      [this.platform.Characteristic.RemoteKey.ARROW_DOWN]: 'down', // 5
      [this.platform.Characteristic.RemoteKey.ARROW_LEFT]: 'left', // 6
      [this.platform.Characteristic.RemoteKey.ARROW_RIGHT]: 'right', // 7
      [this.platform.Characteristic.RemoteKey.SELECT]: 'enter', // 8
      [this.platform.Characteristic.RemoteKey.BACK]: 'exit', // 9
      [this.platform.Characteristic.RemoteKey.EXIT]: 'exit', // 10
      [this.platform.Characteristic.RemoteKey.PLAY_PAUSE]: 'play', // 11
      [this.platform.Characteristic.RemoteKey.INFORMATION]: 'home' // 15
    };
    this.createRxInput();

    // Convenience variables
    this.model = this.accessory.context.device['model'];
    this.zone = this.accessory.context.device['zone'] || 'main';
    this.ip_address = this.accessory.context.device['ip_address'];

    this.eiscp.on('debug', this.eventDebug.bind(this));
		this.eiscp.on('error', this.eventError.bind(this));
		this.eiscp.on('connect', this.eventConnect.bind(this));
    this.eiscp.on('close', this.eventClose.bind(this));
		this.eiscp.on(this.cmdMap[this.zone].power, this.eventSystemPower.bind(this));
		this.eiscp.on(this.cmdMap[this.zone].volume, this.eventVolume.bind(this));
		this.eiscp.on(this.cmdMap[this.zone].muting, this.eventAudioMuting.bind(this));
		this.eiscp.on(this.cmdMap[this.zone].input, this.eventInput.bind(this));

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
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    /**
     * Updating characteristics values asynchronously.
     * 
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     * 
     */
    // let motionDetected = false;
    // setInterval(() => {
    //   // EXAMPLE - inverse the trigger
    //   motionDetected = !motionDetected;

    //   // push the new value to HomeKit
    //   motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
    //   motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);

    //   this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
    //   this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    // }, 10000);
  }

  createRxInput() {
    // Create the RxInput object for later use.
      const eiscpDataAll = require('eiscp/eiscp-commands.json');
      const inSets: Array<string> = [];
      let inputSet: string;
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

  /// ////////////////
	// EVENT FUNCTIONS
	/// ////////////////
	eventDebug(response: string) {
		this.log.debug('eventDebug: %s', response);
	}

	eventError(response: string) {
		this.log.error('eventError: %s', response);
	}

	eventConnect(response: string) {
    this.log.debug('eventConnect: %s', response);
  }
  
  eventClose(response: string) {
		this.log.debug('eventClose: %s', response);
	}

  eventSystemPower(response: string) {
		if (this.receiverState.Power !== (response === 'on'))
			this.log.info('Event - System Power changed: %s', response);

		this.receiverState.Power = (response === 'on');
		this.log.debug('eventSystemPower - message: %s, new state %s', response, this.receiverState.Power);
    // Communicate status
    this.tvService.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.receiverState.Power);
  }

  eventAudioMuting(response: string) {
		this.receiverState.Mute = (response === 'on');
		this.log.debug('eventAudioMuting - message: %s, new receiverState.Mute %s', response, this.receiverState.Mute);
		// Communicate status
    this.tvService.getCharacteristic(this.platform.Characteristic.Mute).updateValue(this.receiverState.Mute);
	}
  
  eventInput(response) {
		if (response) {
			let input = JSON.stringify(response);
			input = input.replace(/[\[\]"]+/g, ''); // eslint-disable-line no-useless-escape
			if (input.includes(','))
				input = input.substring(0, input.indexOf(','));

			// Convert to i_state input code
			const index =
				input !== null ? // eslint-disable-line no-negated-condition
				this.RxInputs.Inputs.findIndex(i => i.label === input) :
				-1;
			if (this.receiverState.Input !== (index + 1))
				this.log.info('Event - Input changed: %s', input);

			this.receiverState.Input = index + 1;

			this.log.debug('eventInput - message: %s - new i_state: %s - input: %s', response, this.receiverState.Input, input);
			// this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(this.i_state);
		} else {
			// Then invalid Input chosen
			this.log.error('eventInput - ERROR - INVALID INPUT - Model does not support selected input.');
		}

    this.tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).updateValue(this.receiverState.Input);
  }
  
  eventVolume(response) {
		// if (this.mapVolume100) {
		// 	const volumeMultiplier = this.maxVolume / 100;
		// 	const newVolume = response / volumeMultiplier;
		// 	this.receiverState.Volume = Math.round(newVolume);
		// 	this.log.debug('eventVolume - message: %s, new receiverState.Volume %s PERCENT', response, this.receiverState.Volume);
		// } else {
			this.receiverState.Volume = response;
			this.log.debug('eventVolume - message: %s, new receiverState.Volume %s ACTUAL', response, this.receiverState.Volume);
		// }

		// Communicate status
    this.tvSpeakerService.getCharacteristic(this.platform.Characteristic.Volume).updateValue(this.receiverState.Volume);
	}


  /// /////////////////////
	// GET AND SET FUNCTIONS
	/// /////////////////////
  setPowerState(powerOn: CharacteristicValue, callback: CharacteristicSetCallback) {
      // do the callback immediately, to free homekit
      // have the event later on execute changes
      this.receiverState.Power = powerOn as boolean;
      callback(null, this.receiverState.Power);
      if (powerOn) {
        this.log.debug('setPowerState - power state: %s, switching to ON', this.receiverState.Power);
        this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].power + '=on', (error, _) => {
          if (error) {
            this.receiverState.Power = false;
            this.log.error('setPowerState - PWR ON: ERROR - current state: %s', this.receiverState.Power);
          }
        });
      } else {
        this.log.debug('setPowerState - power state: %s, switching to OFF', this.receiverState.Power);
        this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].power + '=standby', (error, _) => {
          if (error) {
            this.receiverState.Power = false;
            this.log.error('setPowerState - PWR OFF: ERROR - current state: %s', this.receiverState.Power);
          }
        });
      }
      this.tvService.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.receiverState.Power);
    }

    setInputSource(source: CharacteristicValue, callback: CharacteristicSetCallback) {
        this.receiverState.Input = source as number;
        // do the callback immediately, to free homekit
        // have the event later on execute changes
        callback(null, this.receiverState.Input);

        const label = this.RxInputs.Inputs[this.receiverState.Input - 1].label;
    
        this.log.debug('setInputState - ACTUAL input receiverState.Input: %s - label: %s', this.receiverState.Input, label);
            this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].input + ':' + label, (error, _) => {
          if (error)
            this.log.error('setInputState - INPUT : ERROR - current receiverState.Input:%s - Source:%s', this.receiverState.Input, source.toString());
        });
    
        // Communicate status
        this.tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).updateValue(this.receiverState.Input);
    }

    remoteKeyPress(button: CharacteristicValue, callback: CharacteristicSetCallback) {
      // do the callback immediately, to free homekit
      // have the event later on execute changes
      callback(null, button);
      if (this.buttons[button as number]) {
        const press = this.buttons[button as number];
        this.log.debug('remoteKeyPress - INPUT: pressing key %s', press);
        this.eiscp.command(this.zone + '.setup=' + press, (error, _) => {
          if (error) {
            // this.i_state = 1;
            this.log.error('remoteKeyPress - INPUT: ERROR pressing button %s', press);
          }
        });
      } else {
        this.log.error('Remote button %d not supported.', button);
      }
    }

    setVolumeRelative(volumeDirection: CharacteristicValue, callback: CharacteristicSetCallback) {
        // do the callback immediately, to free homekit
        // have the event later on execute changes
        callback(null, this.receiverState.Volume);
        if (volumeDirection === this.platform.Characteristic.VolumeSelector.INCREMENT) {
          this.log.debug('setVolumeRelative - VOLUME : level-up');
          this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].volume + ':level-up', (error, _) => {
            if (error) {
              this.receiverState.Volume = 0;
              this.log.error('setVolumeRelative - VOLUME : ERROR - current v_state: %s', this.receiverState.Volume);
            }
          });
          this.receiverState.Volume += 1;
        } else if (volumeDirection === this.platform.Characteristic.VolumeSelector.DECREMENT) {
          this.log.debug('setVolumeRelative - VOLUME : level-down');
          this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].volume + ':level-down', (error, _) => {
            if (error) {
              this.receiverState.Volume = 0;
              this.log.error('setVolumeRelative - VOLUME : ERROR - current v_state: %s', this.receiverState.Volume);
            }
          });
          this.receiverState.Volume -= 1;
        } else {
          this.log.error('setVolumeRelative - VOLUME : ERROR - unknown direction sent');
        }
        
        this.tvSpeakerService.getCharacteristic(this.platform.Characteristic.Volume).updateValue(this.receiverState.Volume);
    }

    setVolumeState(volumeLvl: CharacteristicValue, callback: CharacteristicSetCallback) {
    
        // // Are we mapping volume to 100%?
        // if (this.mapVolume100) {
        //   const volumeMultiplier = this.maxVolume / 100;
        //   const newVolume = volumeMultiplier * volumeLvl;
        //   this.v_state = Math.round(newVolume);
        //   this.log.debug('setVolumeState - actual mode, PERCENT, volume v_state: %s', this.v_state);
        // } else if (volumeLvl > this.maxVolume) {
        // // Determin if maxVolume threshold breached, if so set to max.
        //   this.v_state = this.maxVolume;
        //   this.log.debug('setVolumeState - VOLUME LEVEL of: %s exceeds maxVolume: %s. Resetting to max.', volumeLvl, this.maxVolume);
        // } else {
        // // Must be using actual volume number
          this.receiverState.Volume = volumeLvl as number;
          this.log.debug('setVolumeState - actual mode, ACTUAL volume receiverState.Volume: %s', this.receiverState.Volume);
        // }
    
        // do the callback immediately, to free homekit
        // have the event later on execute changes
        callback(null, this.receiverState.Volume);
    
        this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].volume + ':' + this.receiverState.Volume, (error, _) => {
          if (error) {
            this.receiverState.Volume = 0;
            this.log.debug('setVolumeState - VOLUME : ERROR - current receiverState.Volume: %s', this.receiverState.Volume);
          }
        });
    
        this.tvSpeakerService.getCharacteristic(this.platform.Characteristic.Volume).updateValue(this.receiverState.Volume);
    }

    setMuteState(muteOn: CharacteristicValue, callback: CharacteristicSetCallback) {    
        // do the callback immediately, to free homekit
        // have the event later on execute changes
        this.receiverState.Mute = muteOn as boolean;
        callback(null, this.receiverState.Mute);
        if (this.receiverState.Mute) {
          this.log.debug('setMuteState - actual mode, mute receiverState.Mute: %s, switching to ON', this.receiverState.Mute);
          this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].muting + '=on', (error, _) => {
            if (error) {
              this.receiverState.Mute = false;
              this.log.error('setMuteState - MUTE ON: ERROR - current receiverState.Mute: %s', this.receiverState.Mute);
            }
          });
        } else {
          this.log.debug('setMuteState - actual mode, mute receiverState.Mute: %s, switching to OFF', this.receiverState.Mute);
          this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].muting + '=off', (error, _) => {
            if (error) {
              this.receiverState.Mute = false;
              this.log.error('setMuteState - MUTE OFF: ERROR - current receiverState.Mute: %s', this.receiverState.Mute);
            }
          });
        }
    
        // Communicate status
        this.tvSpeakerService.getCharacteristic(this.platform.Characteristic.Mute).updateValue(this.receiverState.Mute);
    }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  // setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {

  //   // implement your own code to turn your device on/off
  //   // this.exampleStates.On = value as boolean;

  //   this.platform.log.debug('Set Characteristic On ->', value);

  //   // you must call the callback function
  //   callback(null);
  // }

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
  // getOn(callback: CharacteristicGetCallback) {

  //   // implement your own code to check if the device is on
  //   const isOn = this.exampleStates.On;

  //   this.platform.log.debug('Get Characteristic On ->', isOn);

  //   // you must call the callback function
  //   // the first argument should be null if there were no errors
  //   // the second argument should be the value to return
  //   callback(null, isOn);
  // }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  // setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {

  //   // implement your own code to set the brightness
  //   this.exampleStates.Brightness = value as number;

  //   this.platform.log.debug('Set Characteristic Brightness -> ', value);

  //   // you must call the callback function
  //   callback(null);
  // }

}
