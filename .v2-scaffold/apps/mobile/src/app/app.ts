/**
 * `apps/mobile` root component — Ionic shell with a single router outlet.
 * The dashboard shell from `@org/dashboard` renders inside the outlet
 * so feature parity with `apps/web` is automatic.
 */
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet, RouterModule],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
  styleUrl: './app.scss',
})
export class App {
  protected title = 'ProjectSites';
}
