INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_native_booking', NULL, 'native_booking', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Native booking engine: availability calculator, 15-min time slot generator with buffer time, conflict detection, business hours validation, booking confirmation with cancellation policy. Replaces Calendly/Acuity for service businesses.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/native_booking/booking.spec.ts"]}');
