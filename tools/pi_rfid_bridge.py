"""RFID bridge for testing without the Pico.

Reads tags with an RC522 wired directly to the Raspberry Pi and publishes
each new tag on MQTT, exactly like the Pico does:
    topic   recordplayer/rfid
    payload first 4 UID bytes as lowercase hex, e.g. "a1b2c3d4"
So a sticker gives the same code here as on the Pico, and links made with
the Record Library app keep working later with the real player.

Wiring (Raspberry Pi 3, next to the MCP3008 on SPI0):
    RC522 SDA  -> pin 26 (GPIO7, SPI0 CE1)
    RC522 SCK  -> pin 23 (GPIO11)  shared with MCP3008 CLK
    RC522 MOSI -> pin 19 (GPIO10)  shared with MCP3008 DIN
    RC522 MISO -> pin 21 (GPIO9)   shared with MCP3008 DOUT
    RC522 RST  -> pin 18 (GPIO24)
    RC522 GND  -> GND
    RC522 3.3V -> 3.3 V (never 5 V)
    RC522 IRQ  -> not connected

Run on the Pi (Mosquitto running there):
    source ~/env/bin/activate
    pip install mfrc522 paho-mqtt     # once, if not installed yet
    python3 pi_rfid_bridge.py
If importing RPi.GPIO fails (newer Pi OS), run: pip install rpi-lgpio
"""

import time

import paho.mqtt.client as mqtt
import RPi.GPIO as GPIO
from mfrc522 import MFRC522

MQTT_BROKER = "localhost"
TOPIC_RFID = "recordplayer/rfid"

SPI_DEVICE = 1          # SPI0 CE1 (pin 26); CE0 stays free for the rest
RST_PIN = 18            # physical pin 18 = GPIO24 (pin 22 is the MCP3008 CS)
POLL_INTERVAL = 0.1     # seconds between reads
RELEASE_TIME = 0.5      # tag gone this long -> the same tag counts as new again


def connect_mqtt():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="rfid-bridge-pi")
    client.connect(MQTT_BROKER, 1883, keepalive=60)
    client.loop_start()
    return client


def read_uid(reader):
    """Return the tag UID as hex (same format as the Pico), or None."""
    status, _ = reader.MFRC522_Request(reader.PICC_REQIDL)
    if status != reader.MI_OK:
        return None

    status, uid = reader.MFRC522_Anticoll()
    if status != reader.MI_OK:
        return None

    return "{:02x}{:02x}{:02x}{:02x}".format(uid[0], uid[1], uid[2], uid[3])


def main():
    reader = MFRC522(bus=0, device=SPI_DEVICE, pin_mode=GPIO.BOARD, pin_rst=RST_PIN)

    # Version register: 0x91 or 0x92 for a real RC522. 0x00 or 0xFF = wiring problem.
    version = reader.Read_MFRC522(0x37)
    print(f"RC522 version: 0x{version:02x}")
    if version in (0x00, 0xFF):
        print("No RC522 found: check SDA (pin 26), MISO/MOSI/SCK and 3.3 V")
        return

    client = connect_mqtt()
    print(f"Publishing tags on {TOPIC_RFID}. Place a sticker on the reader (Ctrl+C to stop).")

    last_uid = None
    missing_since = None

    try:
        while True:
            uid = read_uid(reader)
            now = time.monotonic()

            if uid is not None:
                missing_since = None

                if uid != last_uid:
                    print("RFID:", uid)
                    client.publish(TOPIC_RFID, uid)

                last_uid = uid

            elif last_uid is not None:
                if missing_since is None:
                    missing_since = now
                elif now - missing_since >= RELEASE_TIME:
                    last_uid = None
                    missing_since = None

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("\nStopped")

    finally:
        client.loop_stop()
        client.disconnect()
        GPIO.cleanup()


if __name__ == "__main__":
    main()
