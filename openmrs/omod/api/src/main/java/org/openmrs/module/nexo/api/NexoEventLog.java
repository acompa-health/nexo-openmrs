package org.openmrs.module.nexo.api;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Stores each patient's Nexo event log in the table {@code nexo_event}. It uses plain JDBC on the connection of the
 * current Hibernate session, inside a Spring transaction. It does not read or check the clinical content of an entry.
 */
public class NexoEventLog {

	/** A stored entry: its position in the patient's log and the entry JSON as stored. */
	public static final class Stored {

		public final int seq;

		public final String json;

		Stored(int seq, String json) {
			this.seq = seq;
			this.json = json;
		}
	}

	/** A new entry to append. {@code json} already carries its {@code seq}. */
	public static final class NewEntry {

		public final String kind;

		public final String eventId;

		public final String eventType;

		public final String occurredAt;

		public final String encounterUuid;

		public final String protocolIdentity;

		public final String json;

		public NewEntry(String kind, String eventId, String eventType, String occurredAt, String encounterUuid,
		    String protocolIdentity, String json) {
			this.kind = kind;
			this.eventId = eventId;
			this.eventType = eventType;
			this.occurredAt = occurredAt;
			this.encounterUuid = encounterUuid;
			this.protocolIdentity = protocolIdentity;
			this.json = json;
		}
	}

	/** The client's view of the log is out of date. {@code count} is -1 when another writer won a race. */
	public static final class StaleException extends RuntimeException {

		public final int count;

		StaleException(int count) {
			super("stale log");
			this.count = count;
		}
	}

	/** An entry's event ID is already in the patient's log. */
	public static final class DuplicateException extends RuntimeException {

		public final String eventId;

		DuplicateException(String eventId) {
			super("duplicate event " + eventId);
			this.eventId = eventId;
		}
	}

	private static final int MYSQL_DUPLICATE_KEY = 1062;

	private static final int MYSQL_DEADLOCK = 1213;

	private final DbSessionFactory sessionFactory;

	private final TransactionTemplate writeTx;

	private final TransactionTemplate readTx;

	public NexoEventLog(DbSessionFactory sessionFactory, PlatformTransactionManager transactionManager) {
		this.sessionFactory = sessionFactory;
		this.writeTx = new TransactionTemplate(transactionManager);
		this.readTx = new TransactionTemplate(transactionManager);
		this.readTx.setReadOnly(true);
	}

	/** The patient's entries in seq order. */
	public List<Stored> list(final String patientUuid) {
		return readTx.execute(status -> sessionFactory.getCurrentSession().doReturningWork(connection -> {
			List<Stored> out = new ArrayList<Stored>();
			try (PreparedStatement ps = connection
			        .prepareStatement("SELECT seq, entry_json FROM nexo_event WHERE patient_uuid = ? ORDER BY seq")) {
				ps.setString(1, patientUuid);
				try (ResultSet rs = ps.executeQuery()) {
					while (rs.next()) {
						out.add(new Stored(rs.getInt(1), rs.getString(2)));
					}
				}
			}
			return out;
		}));
	}

	/** The number of entries in the patient's log. */
	public int count(final String patientUuid) {
		return readTx.execute(status -> sessionFactory.getCurrentSession().doReturningWork(connection -> count(connection,
		    patientUuid)));
	}

	/**
	 * Appends all entries in one transaction, or none. The entries take seq {@code expectedSeq},
	 * {@code expectedSeq + 1}, and so on.
	 *
	 * @throws StaleException when the log does not hold exactly {@code expectedSeq} entries
	 * @throws DuplicateException when an entry's event ID is already in the log
	 */
	public void append(final String patientUuid, final int expectedSeq, final List<NewEntry> entries,
	        final int creatorUserId) {
		writeTx.execute(status -> {
			sessionFactory.getCurrentSession().doWork(connection -> {
				int count = count(connection, patientUuid);
				if (count != expectedSeq) {
					throw new StaleException(count);
				}
				String duplicate = firstExistingEventId(connection, patientUuid, entries);
				if (duplicate != null) {
					throw new DuplicateException(duplicate);
				}
				insert(connection, patientUuid, expectedSeq, entries, creatorUserId);
			});
			return null;
		});
	}

	private static int count(Connection connection, String patientUuid) throws SQLException {
		try (PreparedStatement ps = connection.prepareStatement("SELECT COUNT(*) FROM nexo_event WHERE patient_uuid = ?")) {
			ps.setString(1, patientUuid);
			try (ResultSet rs = ps.executeQuery()) {
				rs.next();
				return rs.getInt(1);
			}
		}
	}

	private static String firstExistingEventId(Connection connection, String patientUuid, List<NewEntry> entries)
	        throws SQLException {
		StringBuilder sql = new StringBuilder("SELECT event_id FROM nexo_event WHERE patient_uuid = ? AND event_id IN (");
		sql.append(String.join(",", Collections.nCopies(entries.size(), "?"))).append(")");
		try (PreparedStatement ps = connection.prepareStatement(sql.toString())) {
			ps.setString(1, patientUuid);
			for (int i = 0; i < entries.size(); i++) {
				ps.setString(i + 2, entries.get(i).eventId);
			}
			try (ResultSet rs = ps.executeQuery()) {
				List<String> found = new ArrayList<String>();
				while (rs.next()) {
					found.add(rs.getString(1));
				}
				// Report the first duplicate in request order.
				for (NewEntry e : entries) {
					if (found.contains(e.eventId)) {
						return e.eventId;
					}
				}
				return null;
			}
		}
	}

	private static void insert(Connection connection, String patientUuid, int firstSeq, List<NewEntry> entries,
	        int creatorUserId) throws SQLException {
		String sql = "INSERT INTO nexo_event (uuid, patient_uuid, seq, kind, event_id, event_type, occurred_at,"
		        + " encounter_uuid, protocol_identity, entry_json, creator, date_created)"
		        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
		Timestamp now = new Timestamp(System.currentTimeMillis());
		try (PreparedStatement ps = connection.prepareStatement(sql)) {
			for (int i = 0; i < entries.size(); i++) {
				NewEntry e = entries.get(i);
				ps.setString(1, UUID.randomUUID().toString());
				ps.setString(2, patientUuid);
				ps.setInt(3, firstSeq + i);
				ps.setString(4, e.kind);
				ps.setString(5, e.eventId);
				ps.setString(6, e.eventType);
				ps.setString(7, e.occurredAt);
				ps.setString(8, e.encounterUuid);
				ps.setString(9, e.protocolIdentity);
				ps.setString(10, e.json);
				ps.setInt(11, creatorUserId);
				ps.setTimestamp(12, now);
				ps.addBatch();
			}
			ps.executeBatch();
		}
		catch (SQLException e) {
			// A concurrent append for the same patient took one of these seq values or event IDs first.
			if (isConflict(e)) {
				throw new StaleException(-1);
			}
			throw e;
		}
	}

	/**
	 * A concurrent append won: a duplicate key (MySQL 1062, or any SQLState of class 23, integrity constraint) or a
	 * deadlock or serialization failure (MySQL 1213, SQLState 40001). The client reads the log again and retries.
	 */
	private static boolean isConflict(SQLException e) {
		Throwable x = e;
		for (int depth = 0; x != null && depth < 10; depth++) {
			if (x instanceof SQLException) {
				SQLException sql = (SQLException) x;
				String state = sql.getSQLState();
				if (sql.getErrorCode() == MYSQL_DUPLICATE_KEY || sql.getErrorCode() == MYSQL_DEADLOCK
				        || (state != null && (state.startsWith("23") || state.equals("40001")))) {
					return true;
				}
			}
			x = x.getCause() != null ? x.getCause() : x instanceof SQLException ? ((SQLException) x).getNextException() : null;
		}
		return false;
	}
}
