#include <Wire.h>

const uint8_t MPU_ADDR_1 = 0x68;
uint8_t mpuAddr = MPU_ADDR_1;

const int PIN_LED_VERDE = 4;
const int PIN_LED_AMARILLO = 5;
const int PIN_LED_ROJO = 6;
const int PIN_BUZZER = 8;

// Variables para calibrar el estado de reposo inicial
int16_t baseAX = 0, baseAY = 0, baseAZ = 0;
bool baselineReady = false;
unsigned long baselineStartMs = 0;
int32_t accumX = 0, accumY = 0, accumZ = 0;
int baselineSamples = 0;


const int32_t THRESH_LEVE     = 3000;  // Estado normal / movimiento leve
const int32_t THRESH_MODERADO = 6000;  // Movimiento o vibración moderada
const int32_t THRESH_FUERTE   = 10000; // Impacto o vibración muy fuerte

bool tryWakeMPU(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(0x6B); // PWR_MGMT_1
  Wire.write(0x00); // Despertar el sensor
  return Wire.endTransmission() == 0;
}

bool readAccelRaw(int16_t &ax, int16_t &ay, int16_t &az) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(0x3B); // Registro ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom((int)mpuAddr, 6, true);
  if (Wire.available() < 6) return false;

  ax = (Wire.read() << 8) | Wire.read();
  ay = (Wire.read() << 8) | Wire.read();
  az = (Wire.read() << 8) | Wire.read();
  return true;
}

void clearOutputs() {
  digitalWrite(PIN_LED_VERDE, LOW);
  digitalWrite(PIN_LED_AMARILLO, LOW);
  digitalWrite(PIN_LED_ROJO, LOW);
  noTone(PIN_BUZZER);
}


void applyLocalAlarm(int32_t diff) {
  // 1. RANGO MUY FUERTE: Solo Rojo y un único tono agudo de alarma
  if (diff >= THRESH_FUERTE) {
    digitalWrite(PIN_LED_VERDE, LOW);
    digitalWrite(PIN_LED_AMARILLO, LOW);
    digitalWrite(PIN_LED_ROJO, HIGH);
    tone(PIN_BUZZER, 2200, 100); // Tono agudo y claro
  }
  // 2. RANGO MODERADO: Solo Amarillo y un único tono medio
  else if (diff >= THRESH_MODERADO) {
    digitalWrite(PIN_LED_VERDE, LOW);
    digitalWrite(PIN_LED_AMARILLO, HIGH);
    digitalWrite(PIN_LED_ROJO, LOW);
    tone(PIN_BUZZER, 1200, 100); // Tono medio diferenciado
  }
  // 3. RANGO NORMAL / LEVE: Solo Verde encendido, BUZZER EN SILENCIO
  else if (diff >= THRESH_LEVE) {
    digitalWrite(PIN_LED_VERDE, HIGH);
    digitalWrite(PIN_LED_AMARILLO, LOW);
    digitalWrite(PIN_LED_ROJO, LOW);
    noTone(PIN_BUZZER); // Asegura que no suene nada aquí
  }
  // 4. REPOSO TOTAL: Si está completamente quieto, apaga todo
  else {
    clearOutputs();
  }
}

void setup() {
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_AMARILLO, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  clearOutputs();

  Wire.begin();
  Serial.begin(115200);
  delay(200);

  tryWakeMPU(mpuAddr);
  baselineStartMs = millis();
}

void loop() {
  int16_t ax = 0, ay = 0, az = 0;

  if (!readAccelRaw(ax, ay, az)) {
    delay(50);
    return;
  }

  // Etapa de Autocalibración (3 segundos quietos al arrancar)
  if (!baselineReady) {
    accumX += ax;
    accumY += ay;
    accumZ += az;
    baselineSamples++;
    
    if (millis() - baselineStartMs >= 3000) {
      baseAX = accumX / baselineSamples;
      baseAY = accumY / baselineSamples;
      baseAZ = accumZ / baselineSamples;
      baselineReady = true;
    }
    clearOutputs();
  } 
  // Monitoreo en tiempo real
  else {
    int32_t diffX = labs((int32_t)ax - baseAX);
    int32_t diffY = labs((int32_t)ay - baseAY);
    int32_t diffZ = labs((int32_t)az - baseAZ);
    
    // Elegimos el eje con la variación más alta
    int32_t maxDiff = diffX;
    if (diffY > maxDiff) maxDiff = diffY;
    if (diffZ > maxDiff) maxDiff = diffZ;
    
    applyLocalAlarm(maxDiff);
  }

  // Datos para tu monitor y entorno web
  Serial.print(ax);
  Serial.print(",");
  Serial.print(ay);
  Serial.print(",");
  Serial.println(az);

  delay(50); 
}