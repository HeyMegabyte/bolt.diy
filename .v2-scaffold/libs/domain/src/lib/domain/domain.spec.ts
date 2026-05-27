import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Domain } from './domain';

describe('Domain', () => {
  let component: Domain;
  let fixture: ComponentFixture<Domain>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Domain],
    }).compileComponents();

    fixture = TestBed.createComponent(Domain);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
