import Phaser from 'phaser'
import './phaser.css'

const DESIGN_WIDTH = 1280
const DESIGN_HEIGHT = 720
const WORLD_SCREENS = 5
const WORLD_WIDTH = DESIGN_WIDTH * WORLD_SCREENS
const CAMERA_LOCK = 576
const START_POSITION = Math.floor(WORLD_SCREENS / 2) * DESIGN_WIDTH + CAMERA_LOCK
const WALK_SPEED = 440
const LEFT_GATE_POSITION = 150
const RIGHT_GATE_POSITION = WORLD_WIDTH - LEFT_GATE_POSITION
const ASSET_BASE = import.meta.env.BASE_URL

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="game-shell">
    <div id="phaser-game" class="game-canvas" aria-label="地雷ちゃんの地下鉄通路"></div>
    <div id="player-layer" class="player-layer" data-facing="right">
      <div class="player-shadow" aria-hidden="true"></div>
      <div id="player-sprite" class="player-sprite" role="img" aria-label="歩く地雷ちゃん">
        <div class="player-sprite-frames" aria-hidden="true"></div>
      </div>
    </div>
    <div class="screen-tools">
      <button id="reset-button" class="screen-button" type="button" title="出発地点へ戻る" aria-label="出発地点へ戻る">↺</button>
      <div class="distance-chip" aria-live="polite"><small>EXIT</small><strong id="distance-count">0</strong></div>
    </div>
    <div class="zone-sign"><span>地下連絡通路</span><b id="zone-readout">00</b></div>
    <div class="movement-controls" aria-label="移動コントロール">
      <button class="move-button" type="button" data-direction="left" title="左へ移動" aria-label="左へ移動">←</button>
      <button class="move-button" type="button" data-direction="right" title="右へ移動" aria-label="右へ移動">→</button>
    </div>
    <div id="fade-overlay" class="fade-overlay" aria-hidden="true"></div>
    <p id="status-message" class="screen-reader-message" aria-live="polite">地下道は、どこまでも続いている。</p>
  </main>
`

const playerLayer = document.querySelector('#player-layer')
const distanceCount = document.querySelector('#distance-count')
const zoneReadout = document.querySelector('#zone-readout')
const statusMessage = document.querySelector('#status-message')
const resetButton = document.querySelector('#reset-button')
const moveButtons = [...document.querySelectorAll('[data-direction]')]
const fadeOverlay = document.querySelector('#fade-overlay')

const controls = new Set()
let isPlayerWalking = false
let activeScene

function currentDirection() {
  const movingLeft = controls.has('left')
  const movingRight = controls.has('right')

  if (movingLeft === movingRight) {
    return 0
  }

  return movingLeft ? -1 : 1
}

function setPlayerWalking(isWalking, facing) {
  playerLayer.dataset.facing = facing

  if (isPlayerWalking === isWalking) {
    return
  }

  isPlayerWalking = isWalking
  playerLayer.classList.toggle('is-walking', isWalking)
}

function outlinedRect(graphics, x, y, width, height, fillColor, lineColor = 0x283235, lineWidth = 3) {
  graphics.fillStyle(fillColor, 1)
  graphics.fillRect(x, y, width, height)
  graphics.lineStyle(lineWidth, lineColor, 1)
  graphics.strokeRect(x, y, width, height)
}

function drawTileField(graphics, x, y, width, height, cellWidth, cellHeight) {
  graphics.lineStyle(2, 0x9ca5a1, 1)

  for (let column = x; column <= x + width; column += cellWidth) {
    graphics.lineBetween(column, y, column, y + height)
  }

  for (let row = y; row <= y + height; row += cellHeight) {
    graphics.lineBetween(x, row, x + width, row)
  }
}

class UnderpassScene extends Phaser.Scene {
  constructor() {
    super('underpass')
    this.playerX = START_POSITION
    this.facing = 'right'
    this.routeNumber = 0
    this.isTransitioning = false
    this.awaitingInputRelease = false
  }

  preload() {
    this.load.image('wall-tiles', `${ASSET_BASE}assets/cc0-tiles107-wall.jpg`)
  }

  create() {
    this.cameras.main.setBackgroundColor('#edf0ec')
    this.cameras.main.roundPixels = true
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, DESIGN_HEIGHT)

    this.segments = Array.from({ length: WORLD_SCREENS }, () => this.createSegment())
    this.segments.forEach((segment, index) => {
      segment.container.x = index * DESIGN_WIDTH
      this.drawSegment(segment, index)
    })
    this.drawScreenFrame()
    this.cameras.main.scrollX = Phaser.Math.Clamp(
      this.playerX - CAMERA_LOCK,
      0,
      WORLD_WIDTH - DESIGN_WIDTH,
    )
    this.syncPlayerPosition()
    this.updateHud()
    activeScene = this
  }

  createSegment() {
    const container = this.add.container(0, 0)
    const baseGraphics = this.add.graphics()
    const wallTiles = this.add.tileSprite(0, 92, DESIGN_WIDTH, 426, 'wall-tiles')
      .setOrigin(0, 0)
      .setAlpha(0.9)
    const graphics = this.add.graphics()
    const directionLabel = this.add.text(676, 110, '地下改札', {
      color: '#182224',
      fontFamily: '"Yu Mincho", serif',
      fontSize: '21px',
      fontStyle: 'bold',
    })
    const directionNumber = this.add.text(830, 94, '00', {
      color: '#182224',
      fontFamily: 'Georgia, serif',
      fontSize: '48px',
    })
    const adPrimary = this.add.text(322, 180, 'NIGHT\nLINE', {
      color: '#ffffff',
      fontFamily: 'Georgia, serif',
      fontSize: '22px',
      align: 'center',
    }).setOrigin(0.5)
    const adSecondary = this.add.text(555, 180, 'HIKARI\nSTATION', {
      color: '#7e2449',
      fontFamily: 'Georgia, serif',
      fontSize: '20px',
      align: 'center',
    }).setOrigin(0.5)
    const stripeLabel = this.add.text(490, 476, 'HIKARI UNDERPASS', {
      color: '#273133',
      fontFamily: 'Georgia, serif',
      fontSize: '13px',
      letterSpacing: 2,
    }).setOrigin(0.5)

    container.add([baseGraphics, wallTiles, graphics, directionLabel, directionNumber, adPrimary, adSecondary, stripeLabel])
    return { container, baseGraphics, wallTiles, graphics, directionLabel, directionNumber, adPrimary, adSecondary }
  }

  drawSegment(segment, index) {
    const { baseGraphics, wallTiles, graphics, directionLabel, directionNumber, adPrimary, adSecondary } = segment
    const zone = String(((index % 100) + 100) % 100).padStart(2, '0')
    const variant = ((index + this.routeNumber) % 3 + 3) % 3
    const adColors = [
      [0x4d7899, 0xf0b8cb],
      [0x5e83aa, 0xf1d375],
      [0x87657c, 0xb9dfd0],
    ][variant]

    baseGraphics.clear()
    baseGraphics.fillStyle(0xf0f1ed, 1)
    baseGraphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)

    baseGraphics.fillStyle(0xf7f7f3, 1)
    baseGraphics.fillRect(0, 0, DESIGN_WIDTH, 92)
    baseGraphics.fillStyle(0xe6e9e5, 1)
    baseGraphics.fillRect(0, 92, DESIGN_WIDTH, 426)
    baseGraphics.fillStyle(0xe8ebe5, 1)
    baseGraphics.fillRect(0, 518, DESIGN_WIDTH, 202)

    wallTiles.setTileScale(0.1875, 0.1875)
    wallTiles.setTilePosition(index * 167 + variant * 53, variant * 71)

    graphics.clear()
    graphics.lineStyle(4, 0x293335, 1)
    graphics.lineBetween(0, 518, DESIGN_WIDTH, 518)
    drawTileField(graphics, 0, 518, DESIGN_WIDTH, 202, 24, 17)

    graphics.fillStyle(0x273133, 0.08)
    graphics.fillRect(0, 448, DESIGN_WIDTH, 22)

    graphics.fillStyle(0xf1d444, 1)
    graphics.fillRect(0, 618, DESIGN_WIDTH, 57)
    graphics.lineStyle(3, 0x5a5124, 1)
    graphics.lineBetween(0, 618, DESIGN_WIDTH, 618)
    graphics.lineBetween(0, 675, DESIGN_WIDTH, 675)
    graphics.fillStyle(0xc0a324, 1)
    for (let x = 8; x < DESIGN_WIDTH; x += 16) {
      for (let y = 627; y < 669; y += 12) {
        graphics.fillCircle(x, y, 2)
      }
    }

    graphics.fillStyle(0xd6dad3, 1)
    graphics.fillRect(0, 470, DESIGN_WIDTH, 17)
    graphics.lineStyle(3, 0x354042, 1)
    graphics.lineBetween(0, 470, DESIGN_WIDTH, 470)
    graphics.lineBetween(0, 487, DESIGN_WIDTH, 487)

    this.drawUtilityDoor(graphics, 34, 127, 116, 321)
    this.drawElevator(graphics, 980, 135, 162, 313)

    outlinedRect(graphics, 182, 148, 168, 126, adColors[0])
    outlinedRect(graphics, 470, 148, 172, 126, adColors[1])
    this.drawPosterMotif(graphics, 182, 148, 168, 126, variant, 'night')
    this.drawPosterMotif(graphics, 470, 148, 172, 126, variant, 'station')
    outlinedRect(graphics, 700, 79, 220, 83, 0xf3d743)
    graphics.lineStyle(3, 0x293335, 1)
    graphics.lineBetween(700, 126, 920, 126)
    graphics.lineBetween(893, 98, 893, 147)

    this.drawEmergencyPanel(graphics, 850, 330)

    this.drawColumn(graphics, 370, 92)
    this.drawColumn(graphics, 936, 92)
    this.drawBench(graphics, 500, 445)
    this.drawBin(graphics, 723, 441)
    this.drawCctv(graphics, 1186, 28)
    this.drawLamp(graphics, 245, 34)
    this.drawLamp(graphics, 696, 34)

    if (index === 0) {
      this.drawPortal(graphics, 'left')
    }

    if (index === WORLD_SCREENS - 1) {
      this.drawPortal(graphics, 'right')
    }

    directionNumber.setText(zone)
    directionNumber.setPosition(868, 94)
    directionLabel.setPosition(714, 110)
    directionLabel.setText(index % 2 === 0 ? '地下改札' : '連絡通路')
    adPrimary.setColor(variant === 2 ? '#fff5dc' : '#ffffff')
    adSecondary.setColor(variant === 1 ? '#2f5e59' : '#7e2449')
  }

  drawColumn(graphics, x, y) {
    outlinedRect(graphics, x, y, 68, 385, 0xe9ece6)
    graphics.lineStyle(2, 0x9ea7a3, 1)
    for (let line = y + 34; line < y + 385; line += 34) {
      graphics.lineBetween(x + 2, line, x + 66, line)
    }
    outlinedRect(graphics, x - 7, y - 12, 82, 13, 0xcbd1cb)
  }

  drawUtilityDoor(graphics, x, y, width, height) {
    graphics.fillStyle(0x273133, 0.14)
    graphics.fillRect(x + 8, y + 8, width, height)
    outlinedRect(graphics, x, y, width, height, 0xd8ddd6, 0x465152, 4)
    graphics.fillStyle(0xd0d5d0, 1)
    graphics.fillRect(x + 10, y + 12, width - 20, height - 24)
    graphics.lineStyle(2, 0x8b9692, 0.9)
    for (let line = y + 44; line < y + height - 12; line += 34) {
      graphics.lineBetween(x + 12, line, x + width - 12, line)
    }
    graphics.lineStyle(3, 0x5c6767, 1)
    graphics.lineBetween(x + width / 2, y + 14, x + width / 2, y + height - 14)
    graphics.fillStyle(0x354142, 1)
    graphics.fillRoundedRect(x + width - 27, y + height / 2 - 7, 13, 24, 3)
    graphics.fillStyle(0xb7c0bb, 1)
    graphics.fillRect(x + width - 24, y + height / 2 - 4, 7, 2)
  }

  drawElevator(graphics, x, y, width, height) {
    graphics.fillStyle(0x273133, 0.18)
    graphics.fillRect(x + 10, y + 10, width, height)
    outlinedRect(graphics, x, y, width, height, 0xd7dcd7, 0x344042, 4)
    graphics.fillStyle(0x495557, 1)
    graphics.fillRect(x + 12, y + 20, width - 24, height - 32)
    graphics.fillGradientStyle(0xe8ece8, 0xbcc5c2, 0xc9d1ce, 0xf1f3ef, 1)
    graphics.fillRect(x + 17, y + 25, (width - 38) / 2, height - 42)
    graphics.fillGradientStyle(0xc9d1ce, 0xe9eeea, 0xf1f3ef, 0xc7cfcc, 1)
    graphics.fillRect(x + width / 2 + 2, y + 25, (width - 38) / 2, height - 42)
    graphics.lineStyle(2, 0x707b79, 1)
    graphics.lineBetween(x + width / 2, y + 25, x + width / 2, y + height - 17)
    graphics.lineBetween(x + 18, y + height - 26, x + width - 18, y + height - 26)
    graphics.fillStyle(0x1e282a, 1)
    graphics.fillRoundedRect(x + width / 2 - 19, y + 5, 38, 15, 2)
    graphics.fillStyle(0xe6d347, 1)
    graphics.fillRect(x + width / 2 - 7, y + 10, 14, 3)
    graphics.fillStyle(0x354142, 1)
    graphics.fillRoundedRect(x - 23, y + height / 2 - 24, 16, 48, 3)
    graphics.fillStyle(0xf1d444, 1)
    graphics.fillCircle(x - 15, y + height / 2 - 9, 4)
    graphics.fillCircle(x - 15, y + height / 2 + 9, 4)
  }

  drawEmergencyPanel(graphics, x, y) {
    graphics.fillStyle(0x273133, 0.15)
    graphics.fillRect(x + 5, y + 5, 68, 75)
    outlinedRect(graphics, x, y, 68, 75, 0xf0d64a)
    graphics.fillStyle(0x263133, 1)
    graphics.fillRect(x + 13, y + 16, 42, 4)
    graphics.fillStyle(0xf7f7f2, 1)
    graphics.fillCircle(x + 34, y + 42, 11)
    graphics.lineStyle(3, 0x263133, 1)
    graphics.strokeCircle(x + 34, y + 42, 11)
    graphics.fillStyle(0x263133, 1)
    graphics.fillRect(x + 21, y + 61, 26, 3)
  }

  drawBench(graphics, x, y) {
    graphics.fillStyle(0xbf8865, 1)
    graphics.fillRect(x, y, 132, 18)
    graphics.lineStyle(3, 0x523d2f, 1)
    graphics.strokeRect(x, y, 132, 18)
    graphics.lineBetween(x + 13, y + 18, x + 13, y + 42)
    graphics.lineBetween(x + 119, y + 18, x + 119, y + 42)
  }

  drawBin(graphics, x, y) {
    outlinedRect(graphics, x, y, 46, 57, 0x6c9991)
    graphics.fillStyle(0xf4f6e8, 1)
    graphics.fillCircle(x + 23, y + 19, 7)
  }

  drawLamp(graphics, x, y) {
    graphics.fillStyle(0xffffff, 1)
    graphics.fillRoundedRect(x, y, 156, 14, 3)
    graphics.lineStyle(3, 0x414c4e, 1)
    graphics.strokeRoundedRect(x, y, 156, 14, 3)
    graphics.lineStyle(1, 0xd8ded8, 1)
    graphics.lineBetween(x + 12, y + 7, x + 144, y + 7)
  }

  drawCctv(graphics, x, y) {
    graphics.lineStyle(4, 0x303b3d, 1)
    graphics.lineBetween(x + 26, y, x + 26, y + 26)
    graphics.lineBetween(x + 26, y + 26, x + 3, y + 39)
    graphics.fillStyle(0xd7ddda, 1)
    graphics.fillRoundedRect(x, y + 33, 36, 18, 5)
    graphics.lineStyle(3, 0x303b3d, 1)
    graphics.strokeRoundedRect(x, y + 33, 36, 18, 5)
    graphics.fillStyle(0x283234, 1)
    graphics.fillCircle(x + 8, y + 42, 4)
  }

  drawPosterMotif(graphics, x, y, width, height, variant, kind) {
    graphics.lineStyle(2, 0x293335, 0.4)
    graphics.strokeRect(x + 9, y + 9, width - 18, height - 18)

    if (kind === 'night') {
      graphics.fillStyle(0xddeafb, 0.35)
      graphics.fillCircle(x + 40, y + 37, 18)
      graphics.fillStyle(0xf2d743, 0.8)
      graphics.fillCircle(x + 61, y + 35, 8)
      graphics.lineStyle(2, 0xddeafb, 0.72)
      graphics.lineBetween(x + 20, y + 97, x + 74, y + 68)
      graphics.lineBetween(x + 40, y + 105, x + 105, y + 62)
      return
    }

    const accent = [0xd74371, 0x39776f, 0x7a4b88][variant]
    graphics.fillStyle(accent, 0.75)
    graphics.fillCircle(x + 44, y + 46, 18)
    graphics.fillCircle(x + 75, y + 35, 12)
    graphics.fillCircle(x + 99, y + 57, 16)
    graphics.lineStyle(3, 0xffffff, 0.78)
    graphics.lineBetween(x + 26, y + 88, x + 123, y + 88)
    graphics.lineBetween(x + 36, y + 101, x + 113, y + 101)
  }

  drawPortal(graphics, direction) {
    const x = direction === 'left' ? 0 : DESIGN_WIDTH - 176
    graphics.fillStyle(0x090d0e, 1)
    graphics.fillRect(x, 0, 176, DESIGN_HEIGHT)
    graphics.lineStyle(5, 0x111719, 1)
    graphics.strokeRect(x, 0, 176, DESIGN_HEIGHT)
    graphics.fillStyle(0x485356, 1)

    if (direction === 'left') {
      graphics.fillTriangle(111, 360, 145, 333, 145, 387)
    } else {
      graphics.fillTriangle(DESIGN_WIDTH - 111, 360, DESIGN_WIDTH - 145, 333, DESIGN_WIDTH - 145, 387)
    }
  }

  drawScreenFrame() {
    const frame = this.add.graphics().setScrollFactor(0).setDepth(20)
    frame.fillStyle(0x202729, 1)
    frame.fillRect(0, 0, 84, DESIGN_HEIGHT)
    frame.fillRect(DESIGN_WIDTH - 84, 0, 84, DESIGN_HEIGHT)
    frame.lineStyle(4, 0x111719, 1)
    frame.lineBetween(84, 0, 84, DESIGN_HEIGHT)
    frame.lineBetween(DESIGN_WIDTH - 84, 0, DESIGN_WIDTH - 84, DESIGN_HEIGHT)
    frame.lineStyle(2, 0x627073, 1)
    frame.lineBetween(88, 0, 88, DESIGN_HEIGHT)
    frame.lineBetween(DESIGN_WIDTH - 88, 0, DESIGN_WIDTH - 88, DESIGN_HEIGHT)
    frame.fillStyle(0x7e898b, 1)
    frame.fillTriangle(26, 360, 53, 340, 53, 380)
    frame.fillTriangle(DESIGN_WIDTH - 26, 360, DESIGN_WIDTH - 53, 340, DESIGN_WIDTH - 53, 380)
  }

  updateHud() {
    distanceCount.textContent = this.routeNumber
    zoneReadout.textContent = String(this.routeNumber).padStart(2, '0')
  }

  syncPlayerPosition() {
    const screenX = Math.round(this.playerX - this.cameras.main.scrollX)

    if (screenX === this.playerScreenX) {
      return
    }

    this.playerScreenX = screenX
    playerLayer.style.left = `${(screenX / DESIGN_WIDTH) * 100}%`
  }

  resetPosition() {
    this.playerX = START_POSITION
    this.facing = 'right'
    this.routeNumber = 0
    this.awaitingInputRelease = false
    controls.clear()
    setPlayerWalking(false, this.facing)
    this.cameras.main.scrollX = Phaser.Math.Clamp(this.playerX - CAMERA_LOCK, 0, WORLD_WIDTH - DESIGN_WIDTH)
    this.segments.forEach((segment, index) => this.drawSegment(segment, index))
    this.syncPlayerPosition()
    this.updateHud()
    statusMessage.textContent = '出発地点へ戻った。'
  }

  enterGate(direction) {
    if (this.isTransitioning) {
      return
    }

    this.isTransitioning = true
    this.awaitingInputRelease = true
    controls.clear()
    setPlayerWalking(false, this.facing)
    fadeOverlay.classList.add('is-visible')

    window.setTimeout(() => {
      this.routeNumber = direction === 'right'
        ? Math.min(8, this.routeNumber + 1)
        : Math.max(0, this.routeNumber - 1)
      this.playerX = START_POSITION
      this.facing = direction === 'right' ? 'right' : 'left'
      this.cameras.main.scrollX = Phaser.Math.Clamp(this.playerX - CAMERA_LOCK, 0, WORLD_WIDTH - DESIGN_WIDTH)
      this.segments.forEach((segment, index) => this.drawSegment(segment, index))
      this.syncPlayerPosition()
      this.updateHud()
      statusMessage.textContent = `${this.routeNumber} 番通路へ移動した。`
      fadeOverlay.classList.remove('is-visible')
      this.isTransitioning = false
    }, 260)
  }

  releaseMovement() {
    this.awaitingInputRelease = false
  }

  update(_, delta) {
    if (this.isTransitioning || this.awaitingInputRelease) {
      return
    }

    const direction = currentDirection()

    if (direction === 0) {
      setPlayerWalking(false, this.facing)
      return
    }

    this.facing = direction > 0 ? 'right' : 'left'
    this.playerX += direction * WALK_SPEED * (delta / 1000)
    this.cameras.main.scrollX = Phaser.Math.Clamp(this.playerX - CAMERA_LOCK, 0, WORLD_WIDTH - DESIGN_WIDTH)
    setPlayerWalking(true, this.facing)
    this.syncPlayerPosition()

    if (this.playerX <= LEFT_GATE_POSITION) {
      this.enterGate('left')
      return
    }

    if (this.playerX >= RIGHT_GATE_POSITION) {
      this.enterGate('right')
    }
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser-game',
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  backgroundColor: '#edf0ec',
  scene: [UnderpassScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: true,
  },
})

function directionFromKey(key) {
  const normalizedKey = key.toLowerCase()

  if (normalizedKey === 'a' || normalizedKey === 'arrowleft') {
    return 'left'
  }

  if (normalizedKey === 'd' || normalizedKey === 'arrowright') {
    return 'right'
  }

  return null
}

document.addEventListener('keydown', (event) => {
  const direction = directionFromKey(event.key)
  if (!direction) {
    return
  }

  event.preventDefault()
  controls.add(direction)
})

document.addEventListener('keyup', (event) => {
  const direction = directionFromKey(event.key)
  if (direction) {
    controls.delete(direction)
    activeScene?.releaseMovement()
  }
})

window.addEventListener('blur', () => controls.clear())
resetButton.addEventListener('click', () => activeScene?.resetPosition())

moveButtons.forEach((button) => {
  const { direction } = button.dataset

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    button.setPointerCapture(event.pointerId)
    controls.add(direction)
  })

  const releaseDirection = () => controls.delete(direction)
  button.addEventListener('pointerup', () => activeScene?.releaseMovement())
  button.addEventListener('pointercancel', () => activeScene?.releaseMovement())
  button.addEventListener('lostpointercapture', () => activeScene?.releaseMovement())
  button.addEventListener('pointerup', releaseDirection)
  button.addEventListener('pointercancel', releaseDirection)
  button.addEventListener('lostpointercapture', releaseDirection)
})