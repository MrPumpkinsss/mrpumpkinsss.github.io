---
title: "Electromagnetic Auto-Aiming Toy Shooter"
excerpt: >
  This award-winning project integrates Raspberry Pi (for AI vision 
  tracking via I2C) and Arduino (for PID-controlled pan-tilt targeting). 
  Its core innovation is a dual-stage electromagnetic launcher: Capacitors 
  charge to 250V in 10s, then Bluetooth-triggered thyristors release 50A+ 
  pulses through sequenced coils, using precise timing control to achieve 
  magnetic projectile acceleration. The optimized coil activation interval 
  significantly improves kinetic energy output compared to single-stage designs.
  
  <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin-top: 10px;">
    <figure style="margin: 0; flex-basis: 45%; text-align: center;">
      <img src="/images/IMG20240204163946.jpg" alt="Electromagnetic shooter setup" style="width: 100%; height: auto;">
    </figure>
    <figure style="margin: 0; flex-basis: 45%; text-align: center;">
      <img src="/images/mmexport1707388103358.jpg" alt="Dual-stage coil mechanism" style="width: 100%; height: auto;">
    </figure>
  </div>
collection: projects
---

This project won the EIE Microcontroller Application Design Contest (2023-24). It combines Raspberry Pi and Arduino. Raspberry Pi is responsible for image recognition and transmits target coordinate information to Arduino via I2C. Arduino adjusts the pan-tilt with PID control to aim at the target.

Regarding the electromagnetic gun, the design of its circuit is the most challenging part. The capacitor must first be charged to approximately 250V in about ten seconds. The Arduino trigger signal is controlled by a mobile phone Bluetooth signal to activate the thyristor, allowing a current of up to tens of amperes to flow through the coil. This generates a strong magnetic field that propels the magnet out of the barrel at high speed.

In order to accelerate the magnet further, this project uses a dual-stage coil design. By precisely controlling the time difference between the coil activations, the magnet is accelerated more efficiently compared to single-stage designs.

<img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="GitHub" style="width:24px; vertical-align:middle; margin-right:8px;">
[Learn More]()


---

## Multimedia Gallery

### Videos

<div style="display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; margin-top: 20px;">
  <div style="flex: 1 1 300px; max-width: 500px;">
    <video controls style="width:100%;">
      <source src="/images/shooter.mp4" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  </div>
  <div style="flex: 1 1 300px; max-width: 500px;">
    <video controls style="width:100%;">
      <source src="/images/TURRENT2.mp4" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  </div>
</div>

### Images

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px;">
  <!-- Excerpt images and additional gallery images -->
  <div style="text-align: center;">
    <img src="/images/IMG20240204163946.jpg" alt="Electromagnetic shooter setup" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/mmexport1707388103358.jpg" alt="Dual-stage coil mechanism" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/wx_camera_1706185400509.jpg" alt="wx_camera_1706185400509" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/wx_camera_1706185409795.jpg" alt="wx_camera_1706185409795" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/wx_camera_1706340126284.jpg" alt="wx_camera_1706340126284" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/QQ20250321-004542.jpg" alt="QQ20250321-004542" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/mmexport1707388106889.jpg" alt="mmexport1707388106889" style="width: 100%; height: auto;">
  </div>
  <!-- If you wish to show the duplicate mmexport1707388103358.jpg, uncomment the block below -->
  <!--
  <div style="text-align: center;">
    <img src="/images/mmexport1707388103358.jpg" alt="mmexport1707388103358 duplicate" style="width: 100%; height: auto;">
  </div>
  -->
  <div style="text-align: center;">
    <img src="/images/mmexport1707388108881.jpg" alt="mmexport1707388108881" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/IMG20240527143351.jpg" alt="IMG20240527143351" style="width: 100%; height: auto;">
  </div>
  <div style="text-align: center;">
    <img src="/images/IMG20240527143343.jpg" alt="IMG20240527143343" style="width: 100%; height: auto;">
  </div>
</div>