export default class SunPositionCalculator {
  constructor(options = {}) {
    this.latitude = options.latitude || 39.9042
    this.longitude = options.longitude || 116.4074
    this.timezone = options.timezone || 8
  }

  setLocation(latitude, longitude) {
    this.latitude = latitude
    this.longitude = longitude
  }

  setTimezone(timezone) {
    this.timezone = timezone
  }

  calculate(date = new Date()) {
    const jd = this.getJulianDay(date)
    const t = this.getJulianCentury(jd)
    const geomMeanLongSun = this.getGeomMeanLongSun(t)
    const geomMeanAnomSun = this.getGeomMeanAnomSun(t)
    const eccentEarthOrbit = this.getEccentEarthOrbit(t)
    const sunEqOfCtr = this.getSunEqOfCtr(t, geomMeanAnomSun)
    const sunTrueLong = this.getSunTrueLong(geomMeanLongSun, sunEqOfCtr)
    const sunTrueAnom = this.getSunTrueAnom(geomMeanAnomSun, sunEqOfCtr)
    const sunRadVector = this.getSunRadVector(eccentEarthOrbit, sunTrueAnom)
    const sunAppLong = this.getSunAppLong(t, sunTrueLong)
    const meanObliqEcliptic = this.getMeanObliqEcliptic(t)
    const obliqCorr = this.getObliqCorr(t, meanObliqEcliptic)
    const sunRightAsc = this.getSunRightAsc(obliqCorr, sunAppLong)
    const sunDeclin = this.getSunDeclin(obliqCorr, sunAppLong)
    const eqOfTime = this.getEqOfTime(t, geomMeanLongSun, geomMeanAnomSun, eccentEarthOrbit, obliqCorr)
    const solarTimeFix = this.getSolarTimeFix(this.longitude, eqOfTime, this.timezone)
    const trueSolarTime = this.getTrueSolarTime(date, solarTimeFix)
    const hourAngle = this.getHourAngle(trueSolarTime)
    const solarZenithAngle = this.getSolarZenithAngle(this.latitude, sunDeclin, hourAngle)
    const solarElevation = this.getSolarElevation(solarZenithAngle)
    const solarAzimuth = this.getSolarAzimuth(this.latitude, sunDeclin, hourAngle, solarZenithAngle)

    return {
      jd,
      t,
      geomMeanLongSun,
      geomMeanAnomSun,
      eccentEarthOrbit,
      sunEqOfCtr,
      sunTrueLong,
      sunTrueAnom,
      sunRadVector,
      sunAppLong,
      meanObliqEcliptic,
      obliqCorr,
      sunRightAsc,
      sunDeclin,
      eqOfTime,
      solarTimeFix,
      trueSolarTime,
      hourAngle,
      solarZenithAngle,
      elevation: solarElevation,
      azimuth: solarAzimuth
    }
  }

  getDirectionVector(elevation, azimuth) {
    const phi = (90 - elevation) * Math.PI / 180
    const theta = (azimuth - 180) * Math.PI / 180

    const x = Math.sin(phi) * Math.cos(theta)
    const y = Math.cos(phi)
    const z = Math.sin(phi) * Math.sin(theta)

    return { x, y, z }
  }

  getJulianDay(date) {
    return (date / 86400000) + 2440587.5
  }

  getJulianCentury(jd) {
    return (jd - 2451545.0) / 36525.0
  }

  getGeomMeanLongSun(t) {
    let L0 = 280.46646 + t * (36000.76983 + t * 0.0003032)
    while (L0 > 360) L0 -= 360
    while (L0 < 0) L0 += 360
    return L0
  }

  getGeomMeanAnomSun(t) {
    return 357.52911 + t * (35999.05029 - 0.0001537 * t)
  }

  getEccentEarthOrbit(t) {
    return 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  }

  getSunEqOfCtr(t, geomMeanAnomSun) {
    const mrad = geomMeanAnomSun * Math.PI / 180
    const sinm = Math.sin(mrad)
    const sin2m = Math.sin(2 * mrad)
    const sin3m = Math.sin(3 * mrad)
    return sinm * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin2m * (0.019993 - 0.000101 * t) + sin3m * 0.000289
  }

  getSunTrueLong(geomMeanLongSun, sunEqOfCtr) {
    return geomMeanLongSun + sunEqOfCtr
  }

  getSunTrueAnom(geomMeanAnomSun, sunEqOfCtr) {
    return geomMeanAnomSun + sunEqOfCtr
  }

  getSunRadVector(eccentEarthOrbit, sunTrueAnom) {
    const mrad = sunTrueAnom * Math.PI / 180
    return (1.000001018 * (1 - eccentEarthOrbit * eccentEarthOrbit)) / (1 + eccentEarthOrbit * Math.cos(mrad))
  }

  getSunAppLong(t, sunTrueLong) {
    const omega = 125.04 - 1934.136 * t
    return sunTrueLong - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180)
  }

  getMeanObliqEcliptic(t) {
    return 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  }

  getObliqCorr(t, meanObliqEcliptic) {
    const omega = 125.04 - 1934.136 * t
    return meanObliqEcliptic + 0.00256 * Math.cos(omega * Math.PI / 180)
  }

  getSunRightAsc(obliqCorr, sunAppLong) {
    const num = Math.cos(obliqCorr * Math.PI / 180) * Math.sin(sunAppLong * Math.PI / 180)
    const den = Math.cos(sunAppLong * Math.PI / 180)
    return Math.atan2(num, den) * 180 / Math.PI
  }

  getSunDeclin(obliqCorr, sunAppLong) {
    return Math.asin(Math.sin(obliqCorr * Math.PI / 180) * Math.sin(sunAppLong * Math.PI / 180)) * 180 / Math.PI
  }

  getEqOfTime(t, geomMeanLongSun, geomMeanAnomSun, eccentEarthOrbit, obliqCorr) {
    const lrad = geomMeanLongSun * Math.PI / 180
    const mrad = geomMeanAnomSun * Math.PI / 180
    const e = eccentEarthOrbit
    const y = Math.tan((obliqCorr / 2) * Math.PI / 180)
    const y2 = y * y
    const eqTime = y2 * Math.sin(2 * lrad) - 2 * e * Math.sin(mrad) + 4 * e * y2 * Math.sin(mrad) * Math.cos(2 * lrad) - 0.5 * y2 * y2 * Math.sin(4 * lrad) - 1.25 * e * e * Math.sin(2 * mrad)
    return eqTime * 180 / Math.PI * 4
  }

  getSolarTimeFix(longitude, eqOfTime, timezone) {
    return eqOfTime + 4 * longitude - 60 * timezone
  }

  getTrueSolarTime(date, solarTimeFix) {
    let time = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + solarTimeFix
    while (time > 1440) time -= 1440
    while (time < 0) time += 1440
    return time
  }

  getHourAngle(trueSolarTime) {
    return trueSolarTime / 4 - 180
  }

  getSolarZenithAngle(latitude, sunDeclin, hourAngle) {
    const latRad = latitude * Math.PI / 180
    const decRad = sunDeclin * Math.PI / 180
    const haRad = hourAngle * Math.PI / 180
    const cosZenith = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad)
    return Math.acos(cosZenith) * 180 / Math.PI
  }

  getSolarElevation(solarZenithAngle) {
    return 90 - solarZenithAngle
  }

  getSolarAzimuth(latitude, sunDeclin, hourAngle, solarZenithAngle) {
    const latRad = latitude * Math.PI / 180
    const decRad = sunDeclin * Math.PI / 180
    const haRad = hourAngle * Math.PI / 180
    const zenRad = solarZenithAngle * Math.PI / 180

    let azimuth
    if (hourAngle > 0) {
      const num = -Math.sin(latRad) * Math.cos(zenRad) + Math.sin(decRad)
      const den = Math.cos(latRad) * Math.sin(zenRad)
      azimuth = (Math.acos(Math.min(Math.max(num / den, -1), 1)) * 180 / Math.PI + 180) % 360
    } else {
      const num = -Math.sin(latRad) * Math.cos(zenRad) + Math.sin(decRad)
      const den = Math.cos(latRad) * Math.sin(zenRad)
      azimuth = (540 - Math.acos(Math.min(Math.max(num / den, -1), 1)) * 180 / Math.PI) % 360
    }

    return azimuth
  }
}
