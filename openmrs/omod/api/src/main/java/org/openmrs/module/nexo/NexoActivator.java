package org.openmrs.module.nexo;

import org.openmrs.module.BaseModuleActivator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Logs the module start and stop. The module has no other start-up work. */
public class NexoActivator extends BaseModuleActivator {

	private static final Logger log = LoggerFactory.getLogger(NexoActivator.class);

	@Override
	public void started() {
		log.info("Nexo module started: event log at /ws/rest/v1/nexo/patients/{uuid}/log, protocols at /ws/rest/v1/nexo/protocols");
	}

	@Override
	public void stopped() {
		log.info("Nexo module stopped");
	}
}
