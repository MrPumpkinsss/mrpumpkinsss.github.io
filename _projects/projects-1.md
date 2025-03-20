---
title: "Electromagnetic Auto-Aiming Toy Shooter"
excerpt: "This award-winning project integrates Raspberry Pi (for AI vision tracking via I2C) and Arduino (for PID-controlled pan-tilt targeting). Its core innovation is a dual-stage electromagnetic launcher: Capacitors charge to 250V in 10s, then Bluetooth-triggered thyristors release 50A+ pulses through sequenced coils, using precise timing control to achieve magnetic projectile acceleration. The optimized coil activation interval significantly improves kinetic energy output compared to single-stage designs."
collection: projects
---

This project won the EIE Microcontroller Application Design Contest (2023-24). It combines Raspberry Pi and Arduino. Raspberry Pi is responsible for image recognition and transmits target coordinate information to Arduino via I2C. Arduino adjusts the pan-tilt with PID control to aim at the target.

Regarding the electromagnetic gun, the design of its circuit is the most challenging part. The capacitor must first be charged to approximately 250V in about ten seconds. The Arduino trigger signal is controlled by a mobile phone Bluetooth signal to activate the thyristor, allowing a current of up to tens of amperes to flow through the coil. This generates a strong magnetic field that propels the magnet out of the barrel at high speed.

In order to accelerate the magnet further, this project uses a dual-stage coil design. By precisely controlling the time difference between the coil activations, the magnet is accelerated more efficiently compared to single-stage designs.

<video width="800" controls>
  <source src="/images/TURR5ENT2.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>