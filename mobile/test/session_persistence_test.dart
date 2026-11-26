import 'package:flutter_test/flutter_test.dart';
import 'package:demo_operations_mobile/core/api_sync_service.dart';
import 'package:demo_operations_mobile/data/mock_repository.dart';
import 'package:demo_operations_mobile/data/models.dart';

void main() {
  test('session persists across MockRepository instances and clears on logout', () {
    ApiSyncService.clearSession();

    final repo1 = MockRepository();
    expect(repo1.restoreSession(), isFalse);
    expect(repo1.signedIn, isFalse);

    final user = AppUser(
      id: 'usr-owner-1',
      name: 'Ishu Jindal',
      email: 'ishu@durasmart.com',
      role: UserRole.owner,
      department: 'Management',
      employeeId: null,
      phone: '9814000000',
    );
    ApiSyncService.setAuthToken('jwt-access-token-owner-none-usr-owner-1');
    repo1.setSignedInUser(user);

    // Simulate cold app restart with fresh repository instance
    ApiSyncService.authToken = null;
    final repo2 = MockRepository();
    final restored = repo2.restoreSession();

    expect(restored, isTrue);
    expect(repo2.signedIn, isTrue);
    expect(repo2.currentUser?.id, equals('usr-owner-1'));
    expect(repo2.currentUser?.email, equals('ishu@durasmart.com'));
    expect(repo2.currentUser?.isOwner, isTrue);
    expect(ApiSyncService.authToken, equals('jwt-access-token-owner-none-usr-owner-1'));

    // Logout clears persisted session
    repo2.logout();
    expect(repo2.signedIn, isFalse);
    expect(repo2.currentUser, isNull);
    expect(ApiSyncService.authToken, isNull);

    final repo3 = MockRepository();
    expect(repo3.restoreSession(), isFalse);
  });
}
